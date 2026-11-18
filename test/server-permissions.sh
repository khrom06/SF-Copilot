#!/bin/bash
# LIVE server test (not part of ./test/run.sh: it needs a real Home Assistant and two long-lived access tokens).
# Proves that Home Assistant itself, not this card, refuses a non-administrator on the automation config API the card uses.
#   HA_URL=http://homeassistant.local:8123 NONADMIN_TOKEN=... ./test/server-permissions.sh
# Optional: ADMIN_TOKEN=... also checks that an administrator is NOT refused (GET on a missing id must answer 404, nothing is written).
# The non-administrator user must be a real, non-admin Home Assistant user (Settings → People → Users → "Administrator" off).
# Writes nothing when it passes: a refused POST creates nothing; the only POST sent is to a probe id and is expected to be refused.
set -uo pipefail
: "${HA_URL:?set HA_URL}" "${NONADMIN_TOKEN:?set NONADMIN_TOKEN}"
ID="sf_copilot_probe0"; URL="$HA_URL/api/config/automation/config/$ID"; fail=0
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X "$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' ${3:+-d "$3"} "$URL"; }
chk() { if [ "$2" = "$3" ]; then echo "OK   $1 -> $2"; else echo "FAIL $1 -> $2 (expected $3)"; fail=1; fi; }
BODY='{"alias":"probe","triggers":[],"conditions":[],"actions":[],"mode":"single"}'
chk "non-admin GET"    "$(code GET    "$NONADMIN_TOKEN")" 401
chk "non-admin POST"   "$(code POST   "$NONADMIN_TOKEN" "$BODY")" 401
chk "non-admin DELETE" "$(code DELETE "$NONADMIN_TOKEN")" 401
chk "no token GET"     "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL")" 401
if [ -n "${ADMIN_TOKEN:-}" ]; then chk "admin GET (missing id)" "$(code GET "$ADMIN_TOKEN")" 404; fi
exit $fail
