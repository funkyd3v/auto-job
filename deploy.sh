#!/usr/bin/env bash
#
# auto-job — one-command VPS deploy
# Usage: bash deploy.sh
# Requires: root (or sudo), Docker, docker compose plugin, git.
set -euo pipefail

cd "$(dirname "$0")"
PORT="${PORT:-8081}"
DASHBOARD_PORT="$PORT"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 0. Preflight ─────────────────────────────────────────────────────────────
log "Preflight checks..."
command -v git >/dev/null 2>&1        || die "git is not installed (dnf install -y git)"
command -v docker >/dev/null 2>&1     || die "Docker is not installed (dnf install -y docker)"
docker compose version >/dev/null 2>&1 || warn "docker compose plugin missing — install with: dnf install -y docker-compose-plugin"
docker info >/dev/null 2>&1          || die "Docker daemon is not running (systemctl enable --now docker)"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
log "Updating the repo..."
git fetch --all --prune
if [ -n "$(git rev-parse --verify -q origin/main)" ]; then
  git checkout -B main origin/main
fi

# ── 2. Generate .env on first run ─────────────────────────────────────────────
if [ -f .env ]; then
  log ".env already exists — keeping existing secrets."
else
  log "Generating .env with random secrets..."

  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
  REDIS_PASSWORD="$(openssl rand -hex 16)"
  JWT_SECRET="$(openssl rand -hex 32)"
  JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"

  PUBLIC_IP="$(curl -4 -s --max-time 5 ifconfig.me || true)"
  DASHBOARD_URL="${DASHBOARD_URL:-http://${PUBLIC_IP:-YOUR_VPS_IP}:$DASHBOARD_PORT}"

  cat > .env <<EOF
POSTGRES_USER=autojob
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=autojob

REDIS_PASSWORD=$REDIS_PASSWORD

JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

ENCRYPTION_KEY=$ENCRYPTION_KEY

DASHBOARD_URL=$DASHBOARD_URL

COOKIE_SECURE=false

# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=

# VITE_API_URL=
EOF
  log "Created .env — dashboard will be: $DASHBOARD_URL"
fi

# ── 3. Build & start ──────────────────────────────────────────────────────────
log "Building images and starting containers (first build downloads Chromium — be patient)..."
docker compose up -d --build

# ── 4. Wait for healthy backend ───────────────────────────────────────────────
log "Waiting for backend health..."
for i in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://localhost:$DASHBOARD_PORT/health" >/dev/null 2>&1; then
    log "Backend is up."
    break
  fi
  [ "$i" -eq 60 ] && warn "Backend not healthy after 60s — check: docker compose logs -f backend"
  sleep 5
done

# ── 5. Status ─────────────────────────────────────────────────────────────────
echo
docker compose ps
echo
PUBLIC_IP="$(curl -4 -s --max-time 5 ifconfig.me || echo '<VPS_IP>')"
log "Dashboard:  http://$PUBLIC_IP:$DASHBOARD_PORT"
log "Registering / signing in: click \"Create account\" on the login page."
log "Logs:  docker compose logs -f backend"
log "Update later:  bash deploy.sh   (or git pull && docker compose up -d --build)"