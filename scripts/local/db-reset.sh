#!/usr/bin/env bash
# Recrea una base AISLADA de desarrollo/pruebas (no es la base operativa: esa vive en Supabase Cloud).
# Uso: scripts/local/db-reset.sh [nombre_bd]   (por defecto inmo360_dev)
set -euo pipefail
DB="${1:-inmo360_dev}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
ADMIN=${PGADMIN_URL:-"postgresql://postgres:postgres@127.0.0.1:5432/postgres"}

"${PSQL[@]}" "$ADMIN" -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
URL="${ADMIN%/*}/$DB"
"${PSQL[@]}" "$URL" -f "$HERE/auth_shim.sql"
"${PSQL[@]}" "$URL" -c "alter database \"$DB\" set search_path = \"\$user\", public, extensions"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" "$URL" -f "$f"
done
# Credenciales SOLO locales para pruebas aisladas
"${PSQL[@]}" "$URL" -c "alter role inmo_worker with login password 'worker_local_only'" \
                    -c "alter role inmo_web with login password 'web_local_only'"
echo "Base $DB lista."
