# AWS SES Bounce & Complaint Handling Setup

This document covers the one-time AWS setup to wire up bounce and complaint
notifications from SES → SNS → your app. Once done, any bounced or
complained-about email address is automatically suppressed in the database.

---

## Overview

```
SES sends email
  → bounce or complaint occurs
  → SES publishes to SNS topic
  → SNS POSTs to your app webhook
  → app suppresses the email address
```

---

## Step 1 — Create two SNS topics

1. Go to **AWS Console → SNS → Topics**
2. Click **Create topic**
   - Type: **Standard**
   - Name: `ses-bounces`
3. Repeat to create a second topic named `ses-complaints`
4. Copy both **Topic ARNs** — you'll need them for env vars and SES config

---

## Step 2 — Subscribe your app to each topic

Deploy your app first so the webhook URLs are live, then:

1. Open the `ses-bounces` topic → **Create subscription**
   - Protocol: **HTTPS**
   - Endpoint: `https://getfamilyassistant.com/webhooks/ses-bounce`
   - Leave "Enable raw message delivery" **off**
2. Repeat for `ses-complaints` topic:
   - Endpoint: `https://getfamilyassistant.com/webhooks/ses-complaint`

SNS will immediately POST a `SubscriptionConfirmation` message to each URL.
The app handles this automatically — it GETs the `SubscribeURL` to confirm.
The subscription status should change to **Confirmed** within seconds.

> **Check your logs** for `SNS subscription confirmed` to verify.

---

## Step 3 — Configure SES to publish to SNS

1. Go to **AWS Console → SES → Verified identities**
2. Click on `getfamilyassistant.com`
3. Open the **Notifications** tab
4. Under **Feedback notifications**:
   - **Bounce notifications** → select `ses-bounces`
   - **Complaint notifications** → select `ses-complaints`
   - Leave **Delivery notifications** unset (not needed)
5. **Uncheck** "Include original email headers" (keeps payloads small)

---

## Step 4 — Add environment variables

Add these to your production environment (`.env.prod` or your hosting config):

```bash
# SNS topic ARNs for validating inbound webhook calls
SNS_BOUNCE_TOPIC_ARN=arn:aws:sns:eu-north-1:YOUR_ACCOUNT_ID:ses-bounces
SNS_COMPLAINT_TOPIC_ARN=arn:aws:sns:eu-north-1:YOUR_ACCOUNT_ID:ses-complaints
```

Replace `YOUR_ACCOUNT_ID` with your 12-digit AWS account ID.

These are optional but recommended — the app will reject webhook calls from
unexpected topic ARNs if they are set.

---

## Step 5 — Verify it's working

**Test a bounce** (SES sandbox provides a test address):
- Send a test email to `bounce@simulator.amazonses.com`
- Check logs for `SES bounce: email suppressed`
- Check the DB: `SELECT email, email_suppressed, email_suppressed_at FROM users WHERE email = 'bounce@simulator.amazonses.com';`

**Test a complaint:**
- Send to `complaint@simulator.amazonses.com`
- Check logs for `SES complaint: email suppressed`

---

## How suppression works in the app

- `sendViaSES()` checks `isEmailSuppressed()` for every recipient before sending
- Suppressed addresses are silently skipped with a log entry
- Suppression is permanent (no auto-reinstatement) — if a user fixes their
  bounce issue they'll need to be manually unsuppressed in the DB:
  ```sql
  UPDATE users SET email_suppressed = 0, email_suppressed_at = NULL WHERE email = 'user@example.com';
  ```

---

## IAM permissions

Your SES sending IAM user/role already has `ses:SendEmail`. No additional
permissions are needed — SNS calls your app, not the other way around.
