#!/bin/sh
set -eu

cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
if [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  ./node_modules/.bin/tsx prisma/seed.ts
fi
node dist/sync-seed-admin-password.js
exec node dist/server.js
