# ═══════════════════════════════════════════════════════════════════
# Car Rental — image cho Raspberry Pi 5 (arm64), chạy được cả amd64.
# CI build sẵn trên GitHub (runner arm64) → Pi chỉ việc kéo image về.
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: build ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

# better-sqlite3 / sharp thường có bản dựng sẵn; thiếu thì phải tự biên dịch.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# tini: PID 1 chuyển SIGTERM cho node → đóng DB gọn gàng.
# util-linux: setpriv để hạ quyền từ root xuống PUID sau khi sửa quyền ./data.
# fonts-dejavu-core: font để đóng dấu giờ/biển số lên ảnh giao xe.
RUN apt-get update && apt-get install -y --no-install-recommends tini util-linux fonts-dejavu-core ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && setpriv --help >/dev/null

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=builder /app/apps/api/assets ./apps/api/assets
COPY --from=builder /app/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Asia/Ho_Chi_Minh \
    PUID=1000 \
    PGID=1000

COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

# Dấu vân tay bản build — CI truyền vào; trang Cập nhật dùng để so phiên bản.
# Để cuối cùng: đổi commit không làm hỏng cache các layer phía trên.
ARG APP_VERSION=""
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
