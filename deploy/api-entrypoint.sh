#!/bin/sh
set -eu

cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
node dist/sync-seed-admin-password.js
exec node dist/server.js
