#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'HELP'
Usage:
  ./scripts/restore-raw-mysql.sh --bootstrap
  ./scripts/restore-raw-mysql.sh --source certificates|declarations
  ./scripts/restore-raw-mysql.sh --all

Use --bootstrap once, then restore and normalize one source at a time. This is
the low-disk workflow: after a source is normalized, remove its RAW table with
purge-raw-source.sh before restoring the next one. --all retains both RAW
tables and is only for machines with ample storage.
HELP
}

[[ $# -gt 0 ]] || { usage; exit 2; }
[[ "$1" != "--help" && "$1" != "-h" ]] || { usage; exit 0; }
[[ -f .env ]] || { echo "Missing .env. Copy .env.example to .env and set local passwords first." >&2; exit 1; }

set -a
source .env
set +a

for dump in backups/00_schema.sql.gz backups/01_small_tables.sql.gz backups/10_certificate.sql.gz backups/11_declaration.sql.gz; do
  [[ -f "$dump" ]] || { echo "Missing dump: $dump" >&2; exit 1; }
done

echo "Starting RAW MySQL container..."
docker compose up -d raw-mysql
echo "Waiting for MySQL healthcheck..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' sertiki-raw-mysql 2>/dev/null || true)" = "healthy" ]; do sleep 2; done

mysql_exec=(docker compose exec -T -e MYSQL_PWD="$RAW_MYSQL_ROOT_PASSWORD" raw-mysql mysql -uroot --default-character-set=utf8mb4 "$RAW_MYSQL_DATABASE")

run_stage() {
  local label="$1" dump="$2"
  echo "==> Importing ${label}: ${dump}"
  gzip -cd "$dump" | "${mysql_exec[@]}"
  echo "==> Completed ${label}"
}

lock_reader() {
  echo "Locking normalizer account to SELECT-only access..."
  docker compose exec -T -e MYSQL_PWD="$RAW_MYSQL_ROOT_PASSWORD" raw-mysql mysql -uroot -e "REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${RAW_MYSQL_USER}'@'%'; GRANT SELECT ON \`${RAW_MYSQL_DATABASE}\`.* TO '${RAW_MYSQL_USER}'@'%'; FLUSH PRIVILEGES;"
}

bootstrap() {
  # The dump does not create/select a database; Docker creates it from MYSQL_DATABASE.
  run_stage "schema" backups/00_schema.sql.gz
  run_stage "small tables" backups/01_small_tables.sql.gz
  lock_reader
}

case "$1" in
  --bootstrap)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    bootstrap
    ;;
  --source)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    case "$2" in
      certificates) run_stage "certificates" backups/10_certificate.sql.gz ;;
      declarations) run_stage "declarations" backups/11_declaration.sql.gz ;;
      *) usage; exit 2 ;;
    esac
    lock_reader
    ;;
  --all)
    [[ $# -eq 1 ]] || { usage; exit 2; }
    bootstrap
    run_stage "certificates" backups/10_certificate.sql.gz
    run_stage "declarations" backups/11_declaration.sql.gz
    lock_reader
    ;;
  --help|-h)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
