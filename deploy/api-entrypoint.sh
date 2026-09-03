#!/bin/sh
set -eu

cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
exec node dist/server.js
