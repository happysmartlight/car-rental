#!/bin/sh
# ═══════════════════════════════════════════════════════════════════
# Car Rental — dịch vụ cập nhật (chạy trong container docker:cli)
#
# App không tự thay được chính nó, nên việc kéo image mới + khởi động lại
# giao cho container này. Nó KHÔNG mở cổng mạng: chỉ đọc/ghi file trong
# data/update/ (thư mục chung với app):
#   request.env   app → updater   id, action (update|restart), target, backup, restore, compose, script
#   state.env     updater → app   heartbeat, phase, result, message, current, previous…
#   log.txt       nhật ký lần chạy gần nhất
#
# Cập nhật = đổi CAR_RENTAL_VERSION trong .env → pull → up -d → chờ app báo
# đúng phiên bản. Hỏng → tự quay về bản cũ + khôi phục DB sao lưu trước đó.
# Viết sh thuần (busybox), không cần jq/curl.
# ═══════════════════════════════════════════════════════════════════
set -u

SCRIPT_VERSION=1
STACK="${STACK_DIR:?Thiếu STACK_DIR}"
DATA="$STACK/data"
UPD="$DATA/update"
REQ="$UPD/request.env"
WORK="$UPD/request.processing"
STATE="$UPD/state.env"
LOG="$UPD/log.txt"
SERVICE="${SERVICE:-car-rental}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-240}"

mkdir -p "$UPD"
chown "$PUID:$PGID" "$UPD" 2>/dev/null || true

PHASE=idle
RESULT=""
MESSAGE=""
REQ_ID=""
PREVIOUS=""
FINISHED=""
if [ -f "$STATE" ]; then
  RESULT="$(sed -n 's/^result=//p' "$STATE")"
  MESSAGE="$(sed -n 's/^message=//p' "$STATE")"
  PREVIOUS="$(sed -n 's/^previous=//p' "$STATE")"
  FINISHED="$(sed -n 's/^finished_at=//p' "$STATE")"
fi

dc() { docker compose --project-directory "$STACK" -f "$STACK/docker-compose.yml" "$@"; }
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG"; }
env_get() { sed -n "s/^$1=//p" "$STACK/.env" 2>/dev/null | tail -n 1; }
env_set() {
  if grep -q "^$1=" "$STACK/.env" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$STACK/.env"
  else
    printf '%s=%s\n' "$1" "$2" >>"$STACK/.env"
  fi
}
req_get() { sed -n "s/^$1=//p" "$WORK" | head -n 1; }
safe() {
  [ -z "$1" ] && return 0
  case "$1" in *..*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._/-]*$'
}

write_state() {
  tmp="$STATE.tmp.$$"
  {
    echo "heartbeat=$(date +%s)"
    echo "phase=$PHASE"
    echo "request_id=$REQ_ID"
    echo "result=$RESULT"
    echo "message=$(printf '%s' "$MESSAGE" | tr '\n' ' ')"
    echo "current=$(env_get CAR_RENTAL_VERSION)"
    echo "previous=$PREVIOUS"
    echo "finished_at=$FINISHED"
    echo "script_version=$SCRIPT_VERSION"
  } >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$STATE"
}

# Nhịp tim nền trong lúc làm việc lâu (pull image có thể mất vài phút).
HB_PID=""
hb_start() {
  (
    while :; do
      sleep 5
      [ -f "$STATE" ] && sed "s/^heartbeat=.*/heartbeat=$(date +%s)/" "$STATE" >"$STATE.hb" 2>/dev/null && mv -f "$STATE.hb" "$STATE"
    done
  ) &
  HB_PID=$!
}
hb_stop() {
  [ -n "$HB_PID" ] && kill "$HB_PID" 2>/dev/null
  [ -n "$HB_PID" ] && wait "$HB_PID" 2>/dev/null
  HB_PID=""
}

# Các service cần chạy (trừ chính updater — tự recreate mình giữa chừng là tự sát).
app_services() { dc config --services 2>/dev/null | grep -v '^updater$' | tr '\n' ' '; }

# Chờ app trả /api/health với đúng phiên bản (bỏ trống = chỉ cần khỏe).
# Hạn chờ tính theo đồng hồ thật (tra DNS lúc container chết có thể treo lâu),
# và bỏ cuộc sớm nếu container đã khởi động lỗi liên tục.
health_wait() {
  want="$1"
  deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  cid="$(dc ps -q "$SERVICE" 2>/dev/null | head -n 1)"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    out="$(wget -qO- -T 3 "http://$SERVICE:3000/api/health" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q '"ok":true'; then
      if [ -z "$want" ] || [ "$want" = "latest" ] || printf '%s' "$out" | grep -q "\"version\":\"$want\""; then
        return 0
      fi
    fi
    if [ -n "$cid" ]; then
      restarts="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
      if [ "${restarts:-0}" -ge 3 ]; then
        log "Container $SERVICE khởi động lỗi liên tục ($restarts lần)"
        return 1
      fi
    fi
    sleep 3
  done
  return 1
}

restore_db() {
  src="$1"
  log "Khôi phục dữ liệu từ $(basename "$src")"
  gunzip -c "$src" >"$DATA/db.sqlite.restore" 2>>"$LOG" || return 1
  rm -f "$DATA/db.sqlite-wal" "$DATA/db.sqlite-shm"
  mv -f "$DATA/db.sqlite.restore" "$DATA/db.sqlite"
  chown "$PUID:$PGID" "$DATA/db.sqlite" 2>/dev/null || true
}

finish() {
  hb_stop
  RESULT="$1"
  MESSAGE="$2"
  FINISHED="$(date +%s)"
  PHASE="$3"
  write_state
  log "=== $MESSAGE ==="
  PHASE=idle
  write_state
}

do_restart() {
  : >"$LOG"
  RESULT=""
  FINISHED=""
  PHASE=restarting
  write_state
  hb_start
  log "Khởi động lại $SERVICE"
  dc restart "$SERVICE" >>"$LOG" 2>&1
  if health_wait ""; then finish ok "Đã khởi động lại" done; else finish failed "App không khởi động lại được" failed; fi
}

do_update() {
  target="$(req_get target)"
  backup="$(req_get backup)"
  restore="$(req_get restore)"
  compose="$(req_get compose)"
  script="$(req_get script)"
  : >"$LOG"
  for v in "$target" "$backup" "$restore" "$compose" "$script"; do
    if ! safe "$v"; then
      finish failed "Yêu cầu không hợp lệ" failed
      return
    fi
  done
  [ -n "$target" ] || { finish failed "Thiếu phiên bản đích" failed; return; }

  PREVIOUS="$(env_get CAR_RENTAL_VERSION)"
  [ -n "$PREVIOUS" ] || PREVIOUS=latest
  cp -f "$STACK/docker-compose.yml" "$UPD/compose.prev.yml"
  PHASE=prepare
  RESULT=""
  MESSAGE=""
  FINISHED=""
  write_state
  hb_start
  log "=== Cập nhật v$PREVIOUS → v$target ==="

  # 1. docker-compose.yml đi kèm bản mới (thêm service/biến…) — kiểm tra trước khi thay.
  if [ -n "$compose" ] && [ -f "$DATA/$compose" ]; then
    if docker compose --project-directory "$STACK" -f "$DATA/$compose" config -q >>"$LOG" 2>&1; then
      cp -f "$DATA/$compose" "$STACK/docker-compose.yml"
      log "Đã áp dụng docker-compose.yml của v$target"
    else
      log "docker-compose.yml mới không hợp lệ — giữ file cũ"
    fi
  fi
  env_set CAR_RENTAL_VERSION "$target"

  # 2. Kéo image
  PHASE=pulling
  write_state
  log "--- docker compose pull ---"
  if ! dc pull $(app_services) >>"$LOG" 2>&1; then
    env_set CAR_RENTAL_VERSION "$PREVIOUS"
    cp -f "$UPD/compose.prev.yml" "$STACK/docker-compose.yml"
    finish failed "Không tải được bản v$target (kiểm tra mạng / quyền truy cập ghcr.io)" failed
    return
  fi

  # 3. Quay về kèm dữ liệu: khôi phục DB trước khi chạy bản đích.
  if [ -n "$restore" ] && [ -f "$DATA/$restore" ]; then
    PHASE=restoring
    write_state
    dc stop "$SERVICE" >>"$LOG" 2>&1
    restore_db "$DATA/$restore" || log "LỖI khôi phục dữ liệu — giữ dữ liệu hiện tại"
  fi

  # 4. Chạy bản mới
  PHASE=restarting
  write_state
  log "--- docker compose up -d ---"
  dc up -d $(app_services) >>"$LOG" 2>&1

  # 5. Kiểm tra sức khỏe; hỏng → quay về
  PHASE=health
  write_state
  if health_wait "$target"; then
    finish ok "Đã lên v$target" done
  else
    log "Bản v$target không khởi động được — quay về v$PREVIOUS"
    PHASE=rolling_back
    write_state
    dc logs --tail 40 "$SERVICE" >>"$LOG" 2>&1
    env_set CAR_RENTAL_VERSION "$PREVIOUS"
    cp -f "$UPD/compose.prev.yml" "$STACK/docker-compose.yml"
    dc stop "$SERVICE" >>"$LOG" 2>&1
    if [ -n "$backup" ] && [ -f "$DATA/$backup" ]; then restore_db "$DATA/$backup" || true; fi
    dc up -d $(app_services) >>"$LOG" 2>&1
    if health_wait ""; then
      finish rolled_back "Bản v$target khởi động lỗi — đã tự quay về v$PREVIOUS" rolled_back
    else
      finish failed "Bản v$target lỗi và quay về v$PREVIOUS cũng không chạy. Xem log, hoặc chạy tay: cd $STACK && docker compose up -d" failed
    fi
  fi

  # 6. Script updater mới đi kèm → thay rồi nạp lại chính mình.
  if [ -n "$script" ] && [ -f "$DATA/$script" ] && ! cmp -s "$DATA/$script" "$STACK/updater/updater.sh"; then
    if head -n 1 "$DATA/$script" | grep -q '^#!/bin/sh'; then
      cp -f "$DATA/$script" "$STACK/updater/updater.sh"
      log "Dịch vụ cập nhật có bản mới — nạp lại"
      rm -f "$WORK"
      exec /bin/sh "$STACK/updater/updater.sh"
    fi
  fi
}

# ── Khởi động ──────────────────────────────────────────────────────
if ! docker compose version >/dev/null 2>&1; then
  echo "updater: thiếu docker compose plugin — cài thêm"
  apk add --no-cache docker-cli-compose >/dev/null 2>&1 || echo "updater: không cài được docker compose"
fi
# Mất điện giữa chừng: yêu cầu đang làm dở coi như thất bại, không chạy lại.
if [ -f "$WORK" ]; then
  REQ_ID="$(req_get id)"
  rm -f "$WORK"
  RESULT=failed
  MESSAGE="Lần cập nhật trước bị gián đoạn (máy khởi động lại?)"
fi
write_state
echo "updater: sẵn sàng (v$SCRIPT_VERSION), stack $STACK"

last=0
while :; do
  if [ -f "$REQ" ]; then
    mv -f "$REQ" "$WORK"
    REQ_ID="$(req_get id)"
    action="$(req_get action)"
    case "$action" in
      update) do_update ;;
      restart) do_restart ;;
      *) log "Bỏ qua yêu cầu lạ: $action" ;;
    esac
    rm -f "$WORK"
    last=0
    [ -n "${UPDATER_ONCE:-}" ] && { write_state; exit 0; }
  fi
  now="$(date +%s)"
  if [ $((now - last)) -ge 10 ]; then
    write_state
    last="$now"
  fi
  sleep 2
done
