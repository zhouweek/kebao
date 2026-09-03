#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '用法: CONFIRM_RESTORE=kebao sh ./scripts/restore-postgres.sh <backup.dump>\n' >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE:-}" != "kebao" ]; then
  printf '恢复会覆盖现有数据，请设置 CONFIRM_RESTORE=kebao 后重试。\n' >&2
  exit 2
fi
if [ ! -r "$1" ]; then
  printf '备份文件不可读: %s\n' "$1" >&2
  exit 2
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-kebao}" -d "${POSTGRES_DB:-kebao}" \
  --clean --if-exists --no-owner --no-privileges < "$1"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps \
  --workdir /app/apps/api \
  --entrypoint ./node_modules/.bin/prisma \
  api migrate deploy
printf '恢复及迁移完成: %s\n' "$1"
