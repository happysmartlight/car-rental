#!/bin/sh
# Entrypoint: sửa quyền thư mục dữ liệu rồi HẠ QUYỀN xuống user thường.
#
# Bind mount ./data:/data ghi đè quyền trong image. Trên DietPi hay chạy compose
# bằng root → ./data thuộc root:root → node (uid 1000) không ghi được DB.
# Script chạy bằng root CHỈ để chown, rồi setpriv xuống PUID:PGID trước khi exec node.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
	mkdir -p "$DATA"
	cur="$(stat -c %u:%g "$DATA" 2>/dev/null || echo -)"
	if [ "$cur" != "$PUID:$PGID" ]; then
		echo "entrypoint: đặt quyền $PUID:$PGID cho $DATA"
		chown -R "$PUID:$PGID" "$DATA"
	else
		# Thư mục gốc đúng nhưng file con có thể do updater (root) tạo ra.
		find "$DATA" -maxdepth 2 ! -user "$PUID" -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
	fi
	exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups -- "$@"
fi

exec "$@"
