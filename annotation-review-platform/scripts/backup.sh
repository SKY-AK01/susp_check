#!/usr/bin/env bash
# pg_dump backup script — add to crontab:
#   0 2 * * * /opt/annotation-review-platform/scripts/backup.sh >> /data/backups/backup.log 2>&1
# §22.3 — backups are the operator's responsibility on a self-managed container Postgres.

set -euo pipefail

BACKUP_DIR="${DATA_DIR:-/data}/backups"
POSTGRES_USER="${POSTGRES_USER:-arplatform}"
POSTGRES_DB="${POSTGRES_DB:-arplatform}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dump_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

echo "[$(date -u +%FT%TZ)] Starting pg_dump → ${BACKUP_FILE}"

# Run pg_dump inside the running postgres container, pipe through gzip
docker compose exec -T postgres \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip > "$BACKUP_FILE"

echo "[$(date -u +%FT%TZ)] Backup complete: $(du -sh "$BACKUP_FILE" | cut -f1)"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "dump_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -u +%FT%TZ)] Pruned backups older than ${RETENTION_DAYS} days."
