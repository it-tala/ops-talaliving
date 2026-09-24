#!/usr/bin/env bash
# Print a simulation's step log as a Markdown table.
#
#   supabase/local/simulate.sh                          # procure → ledger
#   supabase/local/simulate.sh sim_procure_to_ledger > docs/sop/procurement/simulasi.md
#
# A simulation is a smoke file that walks a business flow the way people do it
# and writes each step into `sim_log` (see `smoke/99_sim_procure_to_ledger.sql`).
# `smoke.sh` runs it for its assertions; this prints what it did. It rolls back
# like every smoke file, so it is safe to run as often as you like — against a
# local cluster only, for the same reasons as `rebuild.sh`.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${1:-sim_procure_to_ledger}"
FILE=$(ls "$HERE"/smoke/*_"$NAME".sql 2>/dev/null | head -1)
[ -n "$FILE" ] || { echo "no simulation called $NAME in $HERE/smoke" >&2; exit 2; }

case "$HOST" in
  /*|localhost|127.0.0.1|::1|host.docker.internal) ;;
  *) echo "refusing: PGHOST=$HOST is not local." >&2; exit 2 ;;
esac

echo "| # | Proses | Langkah | Pelaku | Layar | Seam | Hasil | Status | Catatan |"
echo "|---|---|---|---|---|---|---|---|---|"
psql -h "$HOST" -p "$PORT" -U "$USER" -q -v ON_ERROR_STOP=1 -At -F $'\t' -f "$FILE" 2>/dev/null \
  | awk -F'\t' 'NF==9 { for (i=1;i<=9;i++) gsub(/\|/,"\\|",$i);
      printf "| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",$1,$2,$3,$4,($5==""?"":"`"$5"`"),($6==""?"":"`"$6"`"),($7=="TEMUAN"?"**TEMUAN**":$7),$8,$9 }'
