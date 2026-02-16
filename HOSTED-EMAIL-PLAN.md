# Hosted Email - Implementation Plan

## Overview

```
INBOUND (receiving):
School → forwards to → user@inbox.getfamilyassistant.com → SES → S3 → Lambda → App webhook → DB

OUTBOUND (sending):
App → SES API → Daily summaries from noreply@inbox.getfamilyassistant.com → Parents
```

**Region:** eu-north-1 (Stockholm)

---

## Phase 1: AWS Infrastructure

| Step | Status | Requires Verification |
|------|--------|----------------------|
| Create AWS account | Done | No |
| Verify domain `inbox.getfamilyassistant.com` in SES | Waiting | - |
| Add MX record: `10 inbound-smtp.eu-north-1.amazonaws.com` | | No |
| Create S3 bucket `getfamilyassistant-inbound-emails` | | No |
| Add bucket policy for SES | | No |
| Add lifecycle rule (delete after 7 days) | | No |
| Create Lambda IAM role | | No |
| Create Lambda function `getfamilyassistant-email-processor` | | No |
| Deploy `lambda/index.mjs` | | No |
| Add Lambda env vars | | No |
| Create SES receipt rule set | | Yes |
| Set receipt rule set as active | | Yes |
| Request SES production access (exit sandbox) | | Yes |

### Lambda Environment Variables

```
WEBHOOK_URL=https://getfamilyassistant.com/api/email/inbound
WEBHOOK_SECRET=<same as HOSTED_EMAIL_WEBHOOK_SECRET>
EMAIL_BUCKET=getfamilyassistant-inbound-emails
```

### S3 Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSESPuts",
      "Effect": "Allow",
      "Principal": {
        "Service": "ses.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::getfamilyassistant-inbound-emails/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceAccount": "YOUR_ACCOUNT_ID"
        }
      }
    }
  ]
}
```

### Lambda IAM Role Inline Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::getfamilyassistant-inbound-emails/*"
    }
  ]
}
```

---

## Phase 2: App Configuration

| Step | Status |
|------|--------|
| Add `HOSTED_EMAIL_WEBHOOK_SECRET` to production env | |
| Test webhook endpoint locally | |

---

## Phase 3: Outbound Email

| Step | File | Status |
|------|------|--------|
| Create SES send service | `src/services/sesEmailService.ts` | |
| Update daily summary to use SES | `src/plugins/dailySummary.ts` | |
| Remove `gmail.send` scope | `src/routes/authRoutes.ts` | |
| Deprecate Gmail sending | `src/utils/emailSender.ts` | |

---

## Code Already Complete

| Component | File |
|-----------|------|
| Database schema (migration 13) | `src/db/db.ts` |
| User alias functions | `src/db/userDb.ts` |
| Inbound webhook handler | `src/routes/emailInboundRoutes.ts` |
| Settings API (source switching, alias claiming) | `src/routes/settingsRoutes.ts` |
| Lambda function | `lambda/index.mjs` |

---

## Test Checklist

### Inbound
- [ ] Claim alias in app settings
- [ ] Send email to `alias@inbox.getfamilyassistant.com`
- [ ] Check CloudWatch logs for Lambda
- [ ] Verify email appears in app

### Outbound
- [ ] Trigger daily summary for test user
- [ ] Verify email received from `@inbox.getfamilyassistant.com`
- [ ] Check SES sending metrics

---

## Reference Docs

- `docs/aws-hosted-email-setup.md` - Detailed AWS setup steps
- `docs/hosted-email-implementation.md` - Full implementation spec
- `inbound-email.md` - Architecture overview
- `outbound-email.md` - Outbound approach
