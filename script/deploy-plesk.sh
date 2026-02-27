#!/bin/bash
# Plesk sunucusunda proje kurulumu (LF line endings)
set -e

cd "$(dirname "$0")/.."

echo "[deploy] npm install"
npm install

echo "[deploy] build"
npm run build:prod

echo "[deploy] prune dev deps"
npm prune --omit=dev 2>/dev/null || true

echo "[deploy] logs dir"
mkdir -p logs

echo "[deploy] PM2 start"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
pm2 delete hocam-merhaba 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup 2>/dev/null || true

echo "[deploy] done. Test: curl http://127.0.0.1:5000/healthz"
