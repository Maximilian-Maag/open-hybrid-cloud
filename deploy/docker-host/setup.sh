#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ────────────────────────────────────────────────────────────────────

info()  { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*" >&2; }
error() { echo "[ERROR] $*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || error "This script must be run as root."
}

require_debian() {
  [[ -f /etc/os-release ]] || error "Cannot determine OS."
  # shellcheck source=/dev/null
  source /etc/os-release
  [[ "$ID" == "debian" ]] || error "This script supports Debian only (detected: $ID)."
  info "Detected: $PRETTY_NAME (codename: $VERSION_CODENAME)"
}

install_docker() {
  info "Installing Docker from official Docker repository..."

  apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

  apt-get update -q
  apt-get install -y ca-certificates curl

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  # shellcheck source=/dev/null
  source /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $VERSION_CODENAME stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -q
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  info "Docker installed: $(docker version --format '{{.Server.Version}}')"
}

upgrade_docker() {
  info "Upgrading Docker packages..."
  apt-get update -q
  apt-get install -y --only-upgrade \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  info "Docker upgraded to: $(docker version --format '{{.Server.Version}}')"
}

check_config_files() {
  local missing=0

  if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    warn ".env not found — copying .env.example. Fill in all values before continuing."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    missing=1
  fi

  if [[ ! -f "$SCRIPT_DIR/nginx.conf" ]]; then
    warn "nginx.conf not found — copying nginx.conf.example. Adjust server_name and cert paths."
    cp "$SCRIPT_DIR/nginx.conf.example" "$SCRIPT_DIR/nginx.conf"
    missing=1
  fi

  if [[ $missing -eq 1 ]]; then
    echo
    error "Config files were created from examples. Edit them and re-run."
  fi
}

docker_login_if_needed() {
  if ! docker info 2>/dev/null | grep -q "Username:"; then
    info "Not logged in to Docker Hub — running docker login..."
    docker login
  else
    info "Already logged in to Docker Hub."
  fi
}

compose_up() {
  info "Pulling latest images and starting containers..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" pull
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d
  info "All containers are up."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps
}

# ── Commands ───────────────────────────────────────────────────────────────────

cmd_install() {
  require_root
  require_debian
  install_docker
  check_config_files
  docker_login_if_needed
  compose_up
  echo
  info "Installation complete."
}

cmd_upgrade() {
  require_root
  upgrade_docker
  info "Restarting containers with latest images..."
  compose_up
  echo
  info "Upgrade complete."
}

# ── Entry point ────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: $0 [--install | --upgrade]"
  echo
  echo "  --install   Install Docker and start all containers (first-time setup)"
  echo "  --upgrade   Upgrade Docker packages and pull latest container images"
}

case "${1:-}" in
  --install) cmd_install ;;
  --upgrade) cmd_upgrade ;;
  *) usage; exit 1 ;;
esac
