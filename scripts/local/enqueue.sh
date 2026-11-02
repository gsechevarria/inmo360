#!/usr/bin/env bash
# Encola un trabajo como el propietario (pasa por RLS y por ingest.enqueue_job). Uso:
#   scripts/local/enqueue.sh <db> <job_type> <source_code> '<params json>' [prioridad]
set -euo pipefail
DB=$1; JT=$2; SRC=$3; PARAMS=${4:-'{}'}; PRIO=${5:-100}
psql -X -q -At "postgresql://postgres:postgres@127.0.0.1/$DB" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ingest.enqueue_job('$JT', '$SRC', '{}'::jsonb, '$PARAMS'::jsonb, $PRIO, null);
commit;
SQL
