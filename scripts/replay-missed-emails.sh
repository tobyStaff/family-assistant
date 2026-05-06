#!/usr/bin/env bash
# scripts/replay-missed-emails.sh
# Re-invokes the Lambda for every S3 object since SINCE_DATE.
# Already-stored emails return {"status":"duplicate"} from the route, so it's
# safe to include manual-forwards that already worked.
#
# Usage:
#   ./scripts/replay-missed-emails.sh                          # dry-run, default SINCE_DATE
#   DRY_RUN=false ./scripts/replay-missed-emails.sh            # actually invoke
#   DRY_RUN=false SINCE_DATE=2026-05-01 ./scripts/replay-missed-emails.sh
#   ALIAS=toby ./scripts/replay-missed-emails.sh               # only emails to toby@inbox.getfamilyassistant.com
#
# Requires AWS credentials with:
#   - s3:GetObject + s3:ListBucket on getfamilyassistant-inbound-emails
#   - lambda:InvokeFunction on process-all-emails
# The inbox-manager-ses-sender IAM user does NOT have lambda:InvokeFunction.

# Note: not using `set -e` because each S3 download pipes through awk that
# exits on first match — the resulting SIGPIPE on `aws s3 cp` would kill the
# whole script under `set -e`. We handle empty recipients explicitly below.
set -uo pipefail

BUCKET="getfamilyassistant-inbound-emails"
LAMBDA_NAME="getfamilyassistant-email-processor"
LAMBDA_REGION="${LAMBDA_REGION:-eu-north-1}"   # SES inbound region
SINCE_DATE="${SINCE_DATE:-2026-05-04}"
DRY_RUN="${DRY_RUN:-true}"
ALIAS="${ALIAS:-}"   # if set, only replay emails to <ALIAS>@inbox.getfamilyassistant.com

aws s3 ls "s3://$BUCKET/" --recursive \
  | awk -v since="$SINCE_DATE" '$1 >= since' \
  | while read -r date time size key; do

      # Extract envelope recipient from Received: "for <addr>" clause.
      # This is the actual RCPT TO that SES matched on (the alias).
      recipient=$(aws s3 cp "s3://$BUCKET/$key" - 2>/dev/null \
        | tr -d '\r' \
        | awk 'BEGIN{IGNORECASE=1}
               /^$/{exit}
               !t && match($0, /for <[^>]+@inbox\.getfamilyassistant\.com>/) {
                 t=substr($0, RSTART+5, RLENGTH-6); print t; exit
               }')

      if [[ -z "$recipient" ]]; then
        echo "SKIP   $key — no inbox.getfamilyassistant.com envelope recipient in headers"
        continue
      fi

      # Filter by alias if requested.
      if [[ -n "$ALIAS" ]] && [[ "${recipient%%@*}" != "$ALIAS" ]]; then
        continue
      fi

      # Synthetic SES event. Lambda only reads:
      #   mail.messageId          → S3 key to fetch
      #   mail.destination[0]     → fallback recipient
      #   mail.source             → fallback for parsed.from
      #   mail.timestamp / commonHeaders.subject  → logging only
      #   receipt.recipients[0]   → primary recipient (the new fix)
      #   receipt.spamVerdict / virusVerdict      → must be PASS to proceed
      payload=$(cat <<JSON
{
  "Records": [{
    "ses": {
      "mail": {
        "messageId": "$key",
        "destination": ["$recipient"],
        "source": "replay@replay.local",
        "timestamp": "${date}T${time}.000Z",
        "commonHeaders": {"subject": "(replay)"}
      },
      "receipt": {
        "recipients": ["$recipient"],
        "spamVerdict": {"status": "PASS"},
        "virusVerdict": {"status": "PASS"}
      }
    }
  }]
}
JSON
)

      if [[ "$DRY_RUN" == "true" ]]; then
        echo "DRY    $key → $recipient"
        continue
      fi

      echo "REPLAY $key → $recipient"
      aws lambda invoke \
        --region "$LAMBDA_REGION" \
        --function-name "$LAMBDA_NAME" \
        --payload "$payload" \
        --cli-binary-format raw-in-base64-out \
        /tmp/replay-out.json > /tmp/replay-meta.json

      # Print result so you can see status from the webhook
      cat /tmp/replay-out.json
      echo ""
    done
