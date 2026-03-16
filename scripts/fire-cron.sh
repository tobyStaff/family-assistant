#!/usr/bin/env bash
# fire-cron.sh — Trigger a named cron job via the admin HTTP endpoint.
#
# Usage:
#   ./scripts/fire-cron.sh <job-name> [--force] [--user <userId>]
#
# Environment variables:
#   BASE_URL        — default: http://localhost:3000
#   SESSION_COOKIE  — full cookie string e.g. "session_id=s%3Axxx..." (required)
#
# Examples:
#   # Full pipeline (run in order):
#   ./scripts/fire-cron.sh daily-email-fetch
#   ./scripts/fire-cron.sh daily-email-analysis
#   ./scripts/fire-cron.sh daily-summary --force
#
#   # Single user:
#   ./scripts/fire-cron.sh daily-summary --force --user abc123
#
#   # Against production:
#   BASE_URL=https://getfamilyassistant.com SESSION_COOKIE="session_id=xxx" \
#     ./scripts/fire-cron.sh daily-summary --force

set -euo pipefail

KNOWN_JOBS=(daily-summary daily-email-fetch daily-email-analysis onboarding-sequence event-sync-retry)

usage() {
  echo "Usage: $0 <job-name> [--force] [--user <userId>]"
  echo ""
  echo "Known jobs:"
  for j in "${KNOWN_JOBS[@]}"; do echo "  $j"; done
  echo ""
  echo "Environment:"
  echo "  BASE_URL        (default: http://localhost:3000)"
  echo "  SESSION_COOKIE  e.g. \"session_id=s%3Axxx...\" (required)"
  exit 1
}

# Parse arguments
if [[ $# -lt 1 ]]; then usage; fi

JOB="$1"; shift
FORCE=false
USER_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    --user)  USER_ID="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; usage ;;
  esac
done

# Validate job name
VALID=false
for j in "${KNOWN_JOBS[@]}"; do
  [[ "$j" == "$JOB" ]] && VALID=true && break
done
if [[ "$VALID" == false ]]; then
  echo "Error: unknown job '$JOB'"
  echo "Known jobs: ${KNOWN_JOBS[*]}"
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE="${SESSION_COOKIE:-}"

if [[ -z "$COOKIE" ]]; then
  echo "Error: SESSION_COOKIE is not set."
  echo "Get it from browser DevTools → Application → Cookies → session_id"
  echo "  export SESSION_COOKIE=\"session_id=<value>\""
  exit 1
fi

# Build JSON body
BODY="{}"
if [[ "$FORCE" == true && -n "$USER_ID" ]]; then
  BODY="{\"force\":true,\"userId\":\"${USER_ID}\"}"
elif [[ "$FORCE" == true ]]; then
  BODY="{\"force\":true}"
elif [[ -n "$USER_ID" ]]; then
  BODY="{\"userId\":\"${USER_ID}\"}"
fi

URL="${BASE_URL}/admin/cron/${JOB}/fire"
echo "Firing: POST ${URL}"
echo "Body:   ${BODY}"
echo ""

# Make the request, capture HTTP status separately
HTTP_RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: ${COOKIE}" \
  -d "${BODY}" \
  "${URL}")

HTTP_STATUS=$(echo "$HTTP_RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | sed 's/__HTTP_STATUS__//')
BODY_RESPONSE=$(echo "$HTTP_RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')

# Pretty-print response
echo "HTTP ${HTTP_STATUS}"
echo ""
if command -v jq &>/dev/null; then
  echo "$BODY_RESPONSE" | jq .
elif command -v python3 &>/dev/null; then
  echo "$BODY_RESPONSE" | python3 -m json.tool
else
  echo "$BODY_RESPONSE"
fi
echo ""

# Exit non-zero on HTTP error
if [[ "$HTTP_STATUS" != 2* ]]; then
  echo "Error: HTTP ${HTTP_STATUS}"
  exit 1
fi

# Print next step hint
case "$JOB" in
  daily-email-fetch)
    echo "Next step: ./scripts/fire-cron.sh daily-email-analysis" ;;
  daily-email-analysis)
    echo "Next step: ./scripts/fire-cron.sh daily-summary --force" ;;
  daily-summary)
    echo "Done. Check your inbox for the summary email." ;;
  *)
    echo "Done." ;;
esac
