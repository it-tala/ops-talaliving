#!/usr/bin/env bash
# A fresh ladder, the walk's people, and PostgREST told to re-read the schema.
# Local only — `rebuild.sh` refuses anything else.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/../../supabase/local/rebuild.sh" >/dev/null 2>&1
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -v ON_ERROR_STOP=1 -f "$HERE/seed-procurement.sql"
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -v ON_ERROR_STOP=1 -f "$HERE/seed-hr.sql"
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -c "grant anon, authenticated, service_role to authenticator; notify pgrst, 'reload schema';"
echo "reset: ladder rebuilt, walk seeded"
