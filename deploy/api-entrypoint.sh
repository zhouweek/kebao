#!/bin/sh
set -eu

cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
if [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  ./node_modules/.bin/tsx prisma/seed.ts
fi
node dist/sync-seed-admin-password.js
if [ -n "${PLATFORM_ADMIN_PASSWORD:-}" ]; then
  node dist/bootstrap-platform-admin.js
fi
exec node dist/server.js
