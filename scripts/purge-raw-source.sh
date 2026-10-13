#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/purge-raw-source.sh --source certificates|declarations --confirm

Drops only the already normalized RAW source table. The immutable .sql.gz dump
in backups/ is not touched. Run this only after pnpm stats and the evidence
export have confirmed that the source has been normalized successfully.
EOF
}

[[ $# -eq 3 && "$1" == "--source" && "$3" == "--confirm" ]] || { usage; exit 2; }
case "$2" in
  certificates) table="pf_certificate" ;;
  declarations) table="pf_declaration" ;;
  *) usage; exit 2 ;;
esac

[[ -f .env ]] || { echo "Missing .env. Copy .env.example to .env and set local passwords first." >&2; exit 1; }
set -a
source .env
set +a

echo "Dropping RAW table ${table}; the original compressed dump remains in backups/."
docker compose exec -T -e MYSQL_PWD="$RAW_MYSQL_ROOT_PASSWORD" raw-mysql mysql -uroot "$RAW_MYSQL_DATABASE" -e "DROP TABLE IF EXISTS \`${table}\`;"
echo "Removed ${table}."
