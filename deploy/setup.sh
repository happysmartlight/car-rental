#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Car Rental — cài lần đầu trên Raspberry Pi (DietPi / Raspberry Pi OS).
# Đây là lần DUY NHẤT phải mở terminal. Sau đó cập nhật ngay trong app.
#
#   curl -fsSL https://raw.githubusercontent.com/happysmartlight/car-rental/main/deploy/setup.sh | sudo bash
#
# Hoặc từ bản git clone:  sudo bash deploy/setup.sh
# Đổi thư mục cài:        sudo STACK_DIR=/opt/car-rental bash setup.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="happysmartlight/car-rental"
BRANCH="${BRANCH:-main}"
STACK_DIR="${STACK_DIR:-$HOME/car-rental}"
PORT="${PORT:-3002}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo)"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Chạy bằng root: sudo bash setup.sh"

say "Kiểm tra Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin
systemctl enable --now docker >/dev/null 2>&1 || true

say "Chuẩn bị thư mục $STACK_DIR"
mkdir -p "$STACK_DIR/updater" "$STACK_DIR/data"

# Lấy file từ bản clone nếu có, không thì tải từ GitHub.
fetch() {
  if [ -n "$HERE" ] && [ -f "$HERE/$1" ]; then
    cp "$HERE/$1" "$2"
  else
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/deploy/$1" -o "$2"
  fi
}

[ -f "$STACK_DIR/docker-compose.yml" ] || fetch docker-compose.yml "$STACK_DIR/docker-compose.yml"
fetch updater.sh "$STACK_DIR/updater/updater.sh"
chmod +x "$STACK_DIR/updater/updater.sh"

if [ ! -f "$STACK_DIR/.env" ]; then
  say "Tạo .env"
  LAN_IP="$(hostname -I | awk '{print $1}')"
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$VERSION" ] || VERSION=latest
  cat >"$STACK_DIR/.env" <<EOF
# Sinh bởi setup.sh — sửa tay được, rồi chạy: docker compose up -d
STACK_DIR=$STACK_DIR
LAN_IP=$LAN_IP
PORT=$PORT
CAR_RENTAL_VERSION=$VERSION
PUID=1000
PGID=1000
PUBLIC_URL=
EOF
  chmod 600 "$STACK_DIR/.env"
fi
chown -R 1000:1000 "$STACK_DIR/data"

say "Tải image & khởi động"
cd "$STACK_DIR"
docker compose pull || die "Không tải được image. Nếu package ghcr.io còn riêng tư: docker login ghcr.io"
docker compose up -d

if command -v tailscale >/dev/null 2>&1; then
  say "Mở HTTPS qua Tailscale (cổng $PORT)"
  # Luôn chỉ định --https=<cổng>: chạy trần 'tailscale serve' sẽ chiếm cổng 443 của dịch vụ khác.
  tailscale serve --bg --https="$PORT" "$PORT" || echo "  (bỏ qua — tự chạy: tailscale serve --bg --https=$PORT $PORT)"
  TS_NAME="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1)"
fi

say "Xong!"
echo "  Trong mạng nhà:  http://$(grep '^LAN_IP=' .env | cut -d= -f2):$PORT"
[ -n "${TS_NAME:-}" ] && echo "  Qua Tailscale:   https://$TS_NAME:$PORT   (camera quét CCCD cần địa chỉ https này)"
echo "  Mở trang web, tạo tài khoản quản trị ở lần đầu."
echo "  Cập nhật sau này: Cài đặt → Phiên bản & cập nhật (không cần terminal)."
