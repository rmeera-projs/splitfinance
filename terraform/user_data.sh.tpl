#!/bin/bash
# Cloud-init boot script - runs once as root when the instance first starts.
# Logs to /var/log/user-data.log (also visible via `sudo cloud-init status
# --long` / /var/log/cloud-init-output.log) for troubleshooting.
set -ex
exec > >(tee -a /var/log/user-data.log) 2>&1

# --- Docker ---
# Ubuntu 22.04's own apt repos don't carry docker-compose-plugin, so we pull
# from Docker's official install script instead (bundles docker-ce +
# the compose plugin together, and is what Docker itself recommends).
apt-get update -y
apt-get install -y ca-certificates curl gnupg git
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# --- Swap: the free-tier t3.micro only has 1GB RAM, and `docker compose
# build` (npm install + vite build inside the client image) can briefly
# need more than that. A 2GB swap file is cheap insurance against an OOM
# kill mid-build. ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# --- Persistent Postgres data volume ---
# A separate EBS volume (terraform/main.tf's aws_ebs_volume.postgres_data),
# independent of this instance's own lifecycle - the root volume above gets
# destroyed on every instance replacement (which user_data_replace_on_change
# triggers on nearly any config change, including this file), which would
# otherwise silently wipe every user account each time. t3 instances are
# Nitro-based, so the attachment shows up to the OS as an NVMe device, not
# literally the /dev/sdf named in the attachment resource - the stable way
# to find the right one is the /dev/disk/by-id symlink AWS derives from the
# volume ID. The attachment is a separate resource created after this
# instance, so it may not have shown up yet when this script starts -
# hence the wait loop.
EBS_DEVICE="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_$(echo "${postgres_volume_id}" | tr -d '-')"
for i in $(seq 1 30); do
  [ -e "$EBS_DEVICE" ] && break
  sleep 2
done
if [ ! -e "$EBS_DEVICE" ]; then
  echo "ERROR: $EBS_DEVICE never appeared - is aws_volume_attachment.postgres_data attached?" >&2
  exit 1
fi

mkdir -p /mnt/postgres-data
# Only format the FIRST time this volume is ever used (blkid finds no
# filesystem on a brand-new volume) - reformatting on every boot would
# destroy exactly the data this volume exists to protect.
blkid "$EBS_DEVICE" >/dev/null 2>&1 || mkfs.ext4 -F "$EBS_DEVICE"
mount "$EBS_DEVICE" /mnt/postgres-data
grep -q "$EBS_DEVICE" /etc/fstab || echo "$EBS_DEVICE /mnt/postgres-data ext4 defaults,nofail 0 2" >> /etc/fstab

# Postgres's initdb refuses to run directly against a mount point - a
# freshly formatted ext4 filesystem always has a "lost+found" directory at
# its root, which fails initdb's "data directory must be empty" check. An
# empty subdirectory under the mount point is what actually gets
# bind-mounted as pgdata below.
mkdir -p /mnt/postgres-data/pgdata

# --- App ---
git clone --branch "${repo_branch}" --depth 1 "${repo_url}" /opt/splitfinance
cd /opt/splitfinance

# COHERE_API_KEY/RESEND_API_KEY substitute into docker-compose.yml's
# existing $${...:-} patterns via this root .env file (docker compose loads
# .env from the project root automatically). Written even if empty, so
# `docker compose` doesn't warn about an unset variable.
cat > .env <<EOF
COHERE_API_KEY=${cohere_api_key}
RESEND_API_KEY=${resend_api_key}
RESEND_FROM_ADDRESS=${resend_from_address}
EOF

# CLIENT_URL/JWT_SECRET/VITE_API_URL are hardcoded literals in the base
# docker-compose.yml (they're meant to be overridden locally too - see the
# Cloudflare tunnel instructions in README.md), so an override file is what
# actually replaces them, the same mechanism used for local tunnel testing.
#
# This override also adds a Caddy reverse proxy in front of both apps -
# Caddy gets automatic HTTPS (Let's Encrypt) for free just from listing a
# domain in its config, as long as that domain's DNS already points here
# and ports 80/443 are reachable (both required for the ACME HTTP
# challenge). client/server keep their direct port mappings in the base
# compose file too, so http://${eip_address}:5173 / :5000 still work as a
# fallback during the DNS cutover.
cat > docker-compose.override.yml <<EOF
services:
  server:
    environment:
      CLIENT_URL: "https://${domain_name}"
      JWT_SECRET: "${jwt_secret}"
  client:
    environment:
      VITE_API_URL: "https://${api_domain_name}/api"
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - client
      - server
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

# Redefines the base compose file's "pgdata" named volume (left completely
# untouched there, so local dev is unaffected) to bind-mount the persistent
# EBS volume mounted above instead of Docker's normal internal storage -
# the db service's own "pgdata:/var/lib/postgresql/data" line never
# changes, only what "pgdata" itself resolves to on disk.
volumes:
  pgdata:
    driver: local
    driver_opts:
      type: none
      device: /mnt/postgres-data/pgdata
      o: bind
  caddy_data:
  caddy_config:
EOF

# The API (Express/helmet) already sets these for its own responses -
# repeated here too so the frontend site (a static build served by "serve",
# no Express in front of it to add them) gets the same baseline, and so
# neither site depends on the other's stack to stay protected.
cat > Caddyfile <<EOF
${domain_name} {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
	reverse_proxy client:5173
}

${api_domain_name} {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
	reverse_proxy server:5000
}
EOF

docker compose up -d --build
