#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Car Rental — cài lần đầu trên Raspberry Pi (DietPi / Raspberry Pi OS).
# Đây là lần DUY NHẤT phải mở terminal. Sau đó cập nhật ngay trong app.
#
#   curl -fsSL https://raw.githubusercontent.com/happysmartlight/car-rental/main/deploy/setup.sh | sudo bash
#
# Hoặc từ bản git clone:  sudo bash deploy/setup.sh
# Đổi thư mục / cổng:     curl … | sudo STACK_DIR=/opt/car-rental PORT=3005 bash
# Chạy lại nhiều lần được: giữ nguyên .env và dữ liệu đã có.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="happysmartlight/car-rental"
BRANCH="${BRANCH:-main}"
STACK_DIR="${STACK_DIR:-$HOME/car-rental}"
PORT="${PORT:-3002}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die() {
  printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}
# Lệnh nào hỏng ngoài dự kiến thì nói rõ, không thoát im lặng.
trap 'die "Lỗi ở dòng $LINENO: $BASH_COMMAND"' ERR

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

# Bản phát hành mới nhất (trống nếu repo chưa phát hành bản nào).
VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1 || true)"

if [ ! -f "$STACK_DIR/.env" ]; then
  say "Tạo .env"
  [ -n "$VERSION" ] || die "Chưa có bản phát hành nào trên https://github.com/$REPO/releases — đợi bản phát hành đầu tiên rồi chạy lại lệnh này."
  # IP LAN = IP của đường ra mạng mặc định (không lấy nhầm IP docker/tailscale).
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
  [ -n "$LAN_IP" ] || LAN_IP="$(hostname -I | awk '{print $1}')"
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
  echo "  IP LAN: $LAN_IP · cổng: $PORT · phiên bản: v$VERSION"
elif grep -q '^CAR_RENTAL_VERSION=latest$' "$STACK_DIR/.env" && [ -n "$VERSION" ]; then
  sed -i "s/^CAR_RENTAL_VERSION=.*/CAR_RENTAL_VERSION=$VERSION/" "$STACK_DIR/.env"
fi
chown -R 1000:1000 "$STACK_DIR/data"

cd "$STACK_DIR"
PORT="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
PORT="${PORT:-3002}"
if ! docker ps --format '{{.Names}}' | grep -qx car-rental; then
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$PORT\$"; then
    die "Cổng $PORT đang có dịch vụ khác dùng. Sửa PORT trong $STACK_DIR/.env (vd 3005) rồi chạy lại."
  fi
fi

say "Tải image & khởi động"
docker compose pull || die "Không tải được image. Nếu package ghcr.io/happysmartlight/car-rental còn riêng tư: đổi sang Public trên GitHub, hoặc chạy 'docker login ghcr.io'."
docker compose up -d

TS_NAME=""
if command -v tailscale >/dev/null 2>&1; then
  say "Mở HTTPS qua Tailscale (cổng $PORT)"
  # Luôn chỉ định --https=<cổng>: chạy trần 'tailscale serve' sẽ chiếm cổng 443 của dịch vụ khác.
  tailscale serve --bg --https="$PORT" "$PORT" >/dev/null || warn "Không bật được — tự chạy: tailscale serve --bg --https=$PORT $PORT"
  TS_NAME="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1 || true)"
fi

say "Chờ app khởi động"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || warn "App chưa phản hồi — xem log: cd $STACK_DIR && docker compose logs car-rental"

say "Xong!"
echo "  Trong mạng nhà:  http://$(sed -n 's/^LAN_IP=//p' .env):$PORT"
if [ -n "$TS_NAME" ]; then echo "  Qua Tailscale:   https://$TS_NAME:$PORT   (camera quét CCCD cần địa chỉ https này)"; fi
echo "  Mở trang web, tạo tài khoản quản trị ở lần đầu."
echo "  Cập nhật sau này: Cài đặt → Phiên bản & cập nhật (không cần terminal)."
