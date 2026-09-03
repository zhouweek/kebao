#!/bin/sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/kebao-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
umask 077
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-kebao}" -d "${POSTGRES_DB:-kebao}" \
  --format=custom --no-owner --no-privileges > "$BACKUP_FILE"
find "$BACKUP_DIR" -type f -name 'kebao-*.dump' -mtime "+$RETENTION_DAYS" -delete
printf '%s\n' "$BACKUP_FILE"
