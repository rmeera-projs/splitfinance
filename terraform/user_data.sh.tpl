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

# --- App ---
git clone --branch "${repo_branch}" --depth 1 "${repo_url}" /opt/splitfinance
cd /opt/splitfinance

# COHERE_API_KEY substitutes into docker-compose.yml's existing
# $${COHERE_API_KEY:-} pattern via this root .env file (docker compose loads
# .env from the project root automatically). Written even if empty, so
# `docker compose` doesn't warn about an unset variable.
cat > .env <<EOF
COHERE_API_KEY=${cohere_api_key}
EOF

# CLIENT_URL/JWT_SECRET/VITE_API_URL are hardcoded literals in the base
# docker-compose.yml (they're meant to be overridden locally too - see the
# Cloudflare tunnel instructions in README.md), so an override file is what
# actually replaces them, the same mechanism used for local tunnel testing.
cat > docker-compose.override.yml <<EOF
services:
  server:
    environment:
      CLIENT_URL: "http://${eip_address}:5173"
      JWT_SECRET: "${jwt_secret}"
  client:
    environment:
      VITE_API_URL: "http://${eip_address}:5000/api"
EOF

docker compose up -d --build
