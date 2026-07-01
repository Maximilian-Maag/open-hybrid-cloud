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

  if [[ ! -d "$SCRIPT_DIR/certs" ]]; then
    warn "certs/ directory not found — create it and place fullchain.pem and privkey.pem inside."
    missing=1
  fi

  if [[ $missing -eq 1 ]]; then
    echo
    error "Config files or directories are missing. Set them up and re-run."
  fi
}

ask_environment() {
  info "Please select the environment:"
  select env in "dev" "staging" "production"; do
    case $env in
      dev)        IMAGE_TAG="dev";     break;;
      staging)    IMAGE_TAG="staging"; break;;
      production) IMAGE_TAG="latest";  break;;
    esac
  done

  if grep -q "^IMAGE_TAG=" "$SCRIPT_DIR/.env"; then
    sed -i "s~^IMAGE_TAG=.*~IMAGE_TAG=$IMAGE_TAG~" "$SCRIPT_DIR/.env"
  else
    echo "" >> "$SCRIPT_DIR/.env"
    echo "IMAGE_TAG=$IMAGE_TAG" >> "$SCRIPT_DIR/.env"
  fi
  info "Image tag set to: $IMAGE_TAG"
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
  ask_environment
  compose_up
  echo
  info "Installation complete."
  info "Database schema and initial admin user are created on the first request to the backend."
  info "Visit https://\$(grep NEXTAUTH_URL \"$SCRIPT_DIR/.env\" | cut -d= -f2) to open the app."
}

cmd_upgrade() {
  require_root
  upgrade_docker
  info "Restarting containers with latest images..."
  ask_environment
  compose_up
  echo
  info "Upgrade complete."
}

cmd_logs() {
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" logs --follow "${@}"
}

cmd_status() {
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps
}

# ── Entry point ────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: $0 [--install | --upgrade | --logs [service] | --status]"
  echo
  echo "  --install        Install Docker and start all containers (first-time setup)"
  echo "  --upgrade        Upgrade Docker packages and pull latest container images"
  echo "  --logs [svc]     Tail logs (optionally for a specific service: frontend, backend, nginx, postgres)"
  echo "  --status         Show running container status"
}

case "${1:-}" in
  --install) cmd_install ;;
  --upgrade) cmd_upgrade ;;
  --logs)    shift; cmd_logs "$@" ;;
  --status)  cmd_status ;;
  *) usage; exit 1 ;;
esac
