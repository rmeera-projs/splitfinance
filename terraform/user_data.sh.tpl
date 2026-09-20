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
apt-get install -y ca-certificates curl gnupg git awscli
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# --- Secrets ---
# Fetched fresh from SSM Parameter Store (terraform/main.tf's
# aws_ssm_parameter.secrets) via this instance's own IAM role, rather than
# being embedded directly in this script the way they used to be. That
# distinction matters: this script becomes the EC2 instance's user-data,
# readable in plaintext by anyone in the account with
# ec2:DescribeInstanceAttribute permission - a wider audience than whoever
# can read Terraform state, and it persists for the instance's whole
# lifetime, not just this one boot.
# A few retries in case the instance's IAM role credentials haven't
# finished propagating to the metadata service yet - unlikely this far
# into boot (after the apt/Docker install above), but a failure here has
# no fallback, unlike most other steps in this script.
fetch_secret() {
  for i in $(seq 1 5); do
    value=$(aws ssm get-parameter --name "/splitfinance/$1" --with-decryption \
      --region "${aws_region}" --query "Parameter.Value" --output text 2>/dev/null) && break
    sleep 3
  done
  echo "$value"
}
COHERE_API_KEY=$(fetch_secret cohere_api_key)
RESEND_API_KEY=$(fetch_secret resend_api_key)
JWT_SECRET_VALUE=$(fetch_secret jwt_secret)
POSTGRES_PASSWORD_VALUE=$(fetch_secret postgres_password)
ZEROSSL_EAB_KEY_ID=$(fetch_secret zerossl_eab_key_id)
ZEROSSL_EAB_HMAC_KEY=$(fetch_secret zerossl_eab_hmac_key)

# Unlike Cohere/Resend/ZeroSSL (all optional - the app or Caddy just falls
# back gracefully when one is blank, same as before this change), an empty
# JWT secret or Postgres password wouldn't fail loudly - auth would "work"
# with a trivially-guessable secret, or the db/server containers would
# crash-loop on a bad connection string. Both are worth stopping the boot
# over outright if SSM never returned a value after fetch_secret's retries.
if [ -z "$JWT_SECRET_VALUE" ] || [ -z "$POSTGRES_PASSWORD_VALUE" ]; then
  echo "ERROR: failed to fetch jwt_secret or postgres_password from SSM Parameter Store" >&2
  exit 1
fi

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

# --- Persistent data volume (Postgres + Caddy's TLS certs) ---
# A separate EBS volume (terraform/main.tf's aws_ebs_volume.postgres_data,
# named for its original purpose but now also holding Caddy's cert data -
# see below), independent of this instance's own lifecycle - the root
# volume above gets destroyed on every instance replacement (which
# user_data_replace_on_change triggers on nearly any config change,
# including this file). Without this volume, that would silently wipe
# every user account on every replacement; it would *also* force Caddy to
# request a brand new Let's Encrypt certificate on every single
# replacement, which is exactly how this project briefly exhausted Let's
# Encrypt's rate limit (5 certs/domain/week) during one heavy day of
# config changes - certs need to survive replacement just as much as the
# database does. t3 instances are Nitro-based, so the attachment shows up
# to the OS as an NVMe device, not literally the /dev/sdf named in the
# attachment resource - the stable way to find the right one is the
# /dev/disk/by-id symlink AWS derives from the volume ID. The attachment
# is a separate resource created after this instance, so it may not have
# shown up yet when this script starts - hence the wait loop.
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
# bind-mounted as pgdata below. Caddy has no such restriction, but gets its
# own subdirectories too, for the same reason: /data (its certs/ACME
# account state) and /config need to persist across replacement exactly
# like pgdata does.
mkdir -p /mnt/postgres-data/pgdata /mnt/postgres-data/caddy-data /mnt/postgres-data/caddy-config /mnt/postgres-data/dbbackups

# --- App ---
git clone --branch "${repo_branch}" --depth 1 "${repo_url}" /opt/splitfinance
cd /opt/splitfinance

# COHERE_API_KEY/RESEND_API_KEY substitute into docker-compose.yml's
# existing $${...:-} patterns via this root .env file (docker compose loads
# .env from the project root automatically). Written even if empty, so
# `docker compose` doesn't warn about an unset variable.
cat > .env <<EOF
COHERE_API_KEY=$COHERE_API_KEY
RESEND_API_KEY=$RESEND_API_KEY
RESEND_FROM_ADDRESS=${resend_from_address}
EOF

# CLIENT_URL/JWT_SECRET are hardcoded literals in the base docker-compose.yml
# (they're meant to be overridden locally too - see the Cloudflare tunnel
# instructions in README.md), so an override file is what actually replaces
# them, the same mechanism used for local tunnel testing.
#
# The client service is overridden more heavily: the base compose file
# builds client/Dockerfile, which runs Vite's *dev server* - fine for local
# dev, but never meant to be internet-facing (its own vite.config.js has an
# allowedHosts: true comment saying exactly that). Production instead
# builds client/Dockerfile.prod, a real `vite build` served as static files
# by "serve" on port 4173. Vite bakes VITE_API_URL into the built JS at
# build time, not at container start, so it has to be a build arg here
# rather than a runtime environment variable (which is why it moved out of
# the client `environment` block that used to be here).
#
# This override also adds a Caddy reverse proxy in front of both apps -
# Caddy gets automatic HTTPS (Let's Encrypt) for free just from listing a
# domain in its config, as long as that domain's DNS already points here
# and ports 80/443 are reachable (both required for the ACME HTTP
# challenge). server keeps its direct port mapping in the base compose file
# too, so http://${eip_address}:5000 still works as a fallback during the
# DNS cutover; client's base-file mapping (5173, the dev server's port) is
# dead in production since Dockerfile.prod doesn't listen there, so this
# override adds the real 4173 fallback mapping alongside it.
cat > docker-compose.override.yml <<EOF
services:
  db:
    environment:
      POSTGRES_PASSWORD: "$POSTGRES_PASSWORD_VALUE"
  server:
    environment:
      # Two things read this and silently do the wrong thing without it:
      # the session cookie only gets its Secure flag in production (see
      # server/src/utils/authCookie.js), and emailService only withholds the
      # raw password-reset URL from the logs in production. Both guards were
      # written against NODE_ENV and were inert here until it was set.
      NODE_ENV: "production"
      CLIENT_URL: "https://${domain_name}"
      JWT_SECRET: "$JWT_SECRET_VALUE"
      DATABASE_URL: "postgresql://postgres:$POSTGRES_PASSWORD_VALUE@db:5432/splitfinance?schema=public"
    # Replaces the base compose file's default json-file logging with the
    # Docker awslogs driver, so this container's stdout/stderr (the
    # structured JSON lines from server/src/services/securityLog.js, plus
    # everything else it logs) reaches the CloudWatch log group
    # terraform/main.tf's aws_cloudwatch_log_group.server_security creates,
    # instead of only ever being readable via `docker compose logs server`
    # on this one instance. The driver authenticates via this instance's own
    # IAM role (aws_iam_role_policy.ec2_cloudwatch_logs) - no credentials
    # here. awslogs-create-group is deliberately left unset (default false):
    # the group already exists by the time this container starts (the
    # instance depends_on it), so the driver only ever needs to create
    # streams within it, which is all its IAM policy grants.
    #
    # No awslogs-stream option either - that's deliberate, not an omission.
    # "awslogs-stream-prefix" is an ECS task-definition concept; the plain
    # Docker Engine awslogs log driver has no such option; it rejects it
    # outright as an unknown log opt. Leaving awslogs-stream unset falls
    # back to the driver's own default (the container ID), which is unique
    # per boot/redeploy without this file having to invent a naming scheme.
    logging:
      driver: awslogs
      options:
        awslogs-region: "${aws_region}"
        awslogs-group: "/splitfinance/server"
  client:
    build:
      context: ./client
      dockerfile: Dockerfile.prod
      args:
        VITE_API_URL: "https://${api_domain_name}/api"
    ports:
      - "4173:4173"
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
      - /mnt/postgres-data/caddy-data:/data
      - /mnt/postgres-data/caddy-config:/config

# Redefines the base compose file's "pgdata" named volume (left completely
# untouched there, so local dev is unaffected) to bind-mount the persistent
# EBS volume mounted above instead of Docker's normal internal storage -
# the db service's own "pgdata:/var/lib/postgresql/data" line never
# changes, only what "pgdata" itself resolves to on disk. Caddy's volumes
# above are plain bind mounts instead (no such indirection needed - it has
# no equivalent of Postgres's "must be an empty directory" restriction).
volumes:
  pgdata:
    driver: local
    driver_opts:
      type: none
      device: /mnt/postgres-data/pgdata
      o: bind
  # The pre-migration database dumps (server/scripts/migrate-and-start.sh)
  # get the same treatment, and for a sharper reason. Left as an ordinary
  # Docker volume they would live on the root disk, which is destroyed
  # whenever this template changes and the instance is replaced - while the
  # database itself, on this EBS volume, survives. That is exactly backwards:
  # the backups would be the only thing that could not outlive an incident.
  dbbackups:
    driver: local
    driver_opts:
      type: none
      device: /mnt/postgres-data/dbbackups
      o: bind
EOF

# Only the frontend site gets a header block here - it's a static build
# served by "serve", with no Express of its own to add these. The API
# already gets them from helmet (server/src/app.js) on every response;
# adding the same headers again here would just duplicate them, and with
# different defaults between helmet and Caddy for X-Frame-Options and
# Referrer-Policy specifically, the API would end up sending two
# conflicting values for the same header instead of one consistent one.
#
# Content-Security-Policy lives here rather than in helmet too, for the
# same reason: it's the browser-rendered page (this static build) that a
# CSP actually restricts, not the JSON API's responses. style-src needs
# 'unsafe-inline' because InsightsPanel.jsx sets inline style="" attributes
# for its chart bars; connect-src has to name the API's own origin plus its
# WebSocket scheme explicitly since api.splitfinance.org is a different
# origin than this site, so 'self' alone wouldn't cover either XHR/fetch
# calls or the Socket.IO connection to it.
#
# The global options block is only emitted when the ZEROSSL_EAB_KEY_ID
# secret fetched above is non-empty (a bash conditional now, not a
# Terraform one - these values come from SSM at boot, not template vars) -
# an escape hatch for when Let's Encrypt's rate limit (5 certs per exact
# domain set per 7 days) is exhausted, e.g. by several instance
# replacements in a row before certs were persisted (see the comment on
# the EBS volume above). ZeroSSL is a separate, free, browser-trusted CA
# with its own independent limit. Leaving both SSM parameters blank (the
# default) omits this block entirely and Caddy uses Let's Encrypt as normal.
ACME_CONFIG=""
if [ -n "$ZEROSSL_EAB_KEY_ID" ]; then
  ACME_CONFIG="{
	acme_ca https://acme.zerossl.com/v2/DV90
	acme_eab {
		key_id $ZEROSSL_EAB_KEY_ID
		mac_key $ZEROSSL_EAB_HMAC_KEY
	}
}"
fi

cat > Caddyfile <<EOF
$ACME_CONFIG
${domain_name} {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://${api_domain_name} wss://${api_domain_name}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
	}
	reverse_proxy client:4173
}

${api_domain_name} {
	reverse_proxy server:5000
}
EOF

docker compose up -d --build
