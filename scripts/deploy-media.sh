#!/usr/bin/env bash
# Run on the VPS from this checkout, after git pull. Keeps DB bytes for rollback.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup="${BACKUP_DIR:-$PWD/backups/media-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$backup"
docker compose build backend front media-init
# Quiesce uploads and deletions for a consistent database + files backup.
docker compose stop front backend
trap 'echo "Migration interrupted. Backups: $backup. Legacy database bytes have not been pruned. Review the error before restarting with docker compose up -d backend front." >&2' ERR
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/before.dump"
test -s "$backup/before.dump"
docker compose run --rm --no-deps media-init
docker compose run --rm --no-deps backend tee-trade-api media-export
docker compose run --rm --no-deps backend tee-trade-api media-verify
docker compose run --rm --no-deps --entrypoint tar media-init -C /data/media -czf - . > "$backup/media.tar.gz"
test -s "$backup/media.tar.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/after.dump"
test -s "$backup/after.dump"
if command -v sha256sum >/dev/null; then
  sha256sum "$backup/before.dump" "$backup/after.dump" "$backup/media.tar.gz" > "$backup/SHA256SUMS"
else
  shasum -a 256 "$backup/before.dump" "$backup/after.dump" "$backup/media.tar.gz" > "$backup/SHA256SUMS"
fi
docker compose up -d --wait backend front
trap - ERR
printf 'Migration complete. Verified backups: %s\n' "$backup"
echo 'Old DB bytes retained. After checking the site, optional cleanup:'
echo 'docker compose exec -T backend tee-trade-api media-prune-db'
echo 'docker compose exec -T backend tee-trade-api media-verify'
