# AWS Setup for Hosted Email

This guide walks through setting up AWS SES, S3, and Lambda to receive emails at `@inbox.getfamilyassistant.com`.

## Prerequisites

- AWS account (create at https://aws.amazon.com if needed)
- Access to DNS for `getfamilyassistant.com`
- The app's `HOSTED_EMAIL_WEBHOOK_SECRET` value (generate with `openssl rand -hex 32`)

## Overview

```
User forwards email → SES receives → S3 stores → Lambda parses → Webhook to app
```

---

## Step 1: Create AWS Account & IAM User

### 1.1 Create Account
1. Go to https://aws.amazon.com and click "Create an AWS Account"
2. Follow the signup process (requires credit card, but free tier covers our usage)
3. Enable MFA on the root account (Security credentials → Assign MFA device)

### 1.2 Create IAM User for Administration
1. Go to IAM Console → Users → Create user
2. Username: `family-assistant-manager`
3. Select "Provide user access to AWS Management Console"
4. Attach policies: `AdministratorAccess` (or more restrictive if preferred)
5. Save the credentials securely

---

## Step 2: Set Up S3 Bucket

Emails are temporarily stored in S3 before Lambda processes them.

### 2.1 Create Bucket
1. Go to S3 Console → Create bucket
2. **Bucket name**: `getfamilyassistant-inbound-emails`
3. **Region**: `us-east-1` (required for SES email receiving)
4. **Block Public Access**: Keep all settings ON (default)
5. Click "Create bucket"

### 2.2 Add Bucket Policy
1. Click on the bucket → Permissions → Bucket policy → Edit
2. Paste this policy (replace `YOUR_ACCOUNT_ID` with your AWS account ID):

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

3. Click "Save changes"

### 2.3 Add Lifecycle Rule (Optional but Recommended)
1. Go to bucket → Management → Create lifecycle rule
2. **Rule name**: `delete-after-7-days`
3. Apply to all objects
4. Select "Expire current versions of objects"
5. Set "Days after object creation": `7`
6. Click "Create rule"

---

## Step 3: Verify Domain in SES

### 3.1 Add Domain Identity
1. Go to SES Console → Verified identities → Create identity
2. Select "Domain"
3. **Domain**: `inbox.getfamilyassistant.com`
4. Click "Create identity"

### 3.2 Add DNS Records
SES will show you DNS records to add. In your DNS provider (e.g., Cloudflare, Route53):

**DKIM Records** (3 CNAME records):
```
Type: CNAME
Name: [token1]._domainkey.inbox
Value: [token1].dkim.amazonses.com

Type: CNAME
Name: [token2]._domainkey.inbox
Value: [token2].dkim.amazonses.com

Type: CNAME
Name: [token3]._domainkey.inbox
Value: [token3].dkim.amazonses.com
```

**Verification TXT Record** (if shown):
```
Type: TXT
Name: _amazonses.inbox
Value: [verification-string-from-ses]
```

### 3.3 Wait for Verification
- DNS propagation can take 5-10 minutes
- SES will show "Verified" status when complete
- You can click "View DNS records" to see current status

---

## Step 4: Configure MX Records

Add an MX record to route emails to SES:

⏺ Region: Got it - that's eu-north-1. The MX record endpoint would be                                     
  inbound-smtp.eu-north-1.amazonaws.com and SES client should use region: 'eu-north-1'.

```
Type: MX
Name: inbox (or inbox.getfamilyassistant.com depending on provider)
Value: 10 inbound-smtp.us-east-1.amazonaws.com
TTL: 3600
```

**Important**: The MX endpoint depends on your SES region:
- us-east-1: `inbound-smtp.us-east-1.amazonaws.com`
- us-west-2: `inbound-smtp.us-west-2.amazonaws.com`
- eu-west-1: `inbound-smtp.eu-west-1.amazonaws.com`

Verify with: `dig MX inbox.getfamilyassistant.com`

---

## Step 5: Create Lambda Function

### 5.1 Create IAM Role for Lambda
1. Go to IAM Console → Roles → Create role
2. **Trusted entity type**: AWS service
3. **Use case**: Lambda
4. Click "Next"
5. Attach policies:
   - `AWSLambdaBasicExecutionRole` (for CloudWatch logs)
6. Click "Next"
7. **Role name**: `getfamilyassistant-email-processor-role`
8. Click "Create role"
9. Click on the role → Add permissions → Create inline policy
10. Select JSON and paste:

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

11. **Policy name**: `s3-read-emails`
12. Click "Create policy"

### 5.2 Create Lambda Function
1. Go to Lambda Console → Create function
2. **Function name**: `getfamilyassistant-email-processor`
3. **Runtime**: Node.js 20.x
4. **Architecture**: arm64 (cheaper)
5. **Permissions**: Use existing role → `getfamilyassistant-email-processor-role`
6. Click "Create function"

### 5.3 Configure Lambda Settings
1. Go to Configuration → General configuration → Edit
2. **Memory**: 256 MB
3. **Timeout**: 30 seconds
4. Click "Save"

### 5.4 Add Environment Variables
1. Go to Configuration → Environment variables → Edit
2. Add these variables:

| Key | Value |
|-----|-------|
| `WEBHOOK_URL` | `https://getfamilyassistant.com/api/email/inbound` |
| `WEBHOOK_SECRET` | `[your-generated-secret]` |
| `EMAIL_BUCKET` | `getfamilyassistant-inbound-emails` |

3. Click "Save"

### 5.5 Deploy Lambda Code

Create a folder `lambda/` with these files:

**package.json**:
```json
{
  "name": "email-processor-lambda",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "mailparser": "^3.7.1"
  }
}
```

**index.mjs**:
```javascript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';

const s3 = new S3Client({});

export const handler = async (event) => {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const bucket = process.env.EMAIL_BUCKET;

  console.log('Received event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const { mail, receipt } = record.ses;

    // Skip spam/virus
    if (receipt.spamVerdict.status === 'FAIL') {
      console.log(`Skipping spam email: ${mail.messageId}`);
      continue;
    }
    if (receipt.virusVerdict.status === 'FAIL') {
      console.log(`Skipping virus email: ${mail.messageId}`);
      continue;
    }

    try {
      // Fetch raw email from S3
      console.log(`Fetching ${mail.messageId} from S3 bucket ${bucket}`);
      const { Body } = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: mail.messageId,
      }));

      if (!Body) {
        console.error(`No body for message ${mail.messageId}`);
        continue;
      }

      // Parse email
      const bodyBytes = await Body.transformToByteArray();
      const parsed = await simpleParser(Buffer.from(bodyBytes));

      // Extract first recipient
      const recipient = mail.destination[0];
      console.log(`Processing email for ${recipient}`);

      // Build payload
      const payload = {
        messageId: mail.messageId,
        recipient,
        from: parsed.from?.value[0]?.address || mail.source,
        fromName: parsed.from?.value[0]?.name || undefined,
        subject: parsed.subject || '(no subject)',
        textBody: parsed.text || undefined,
        htmlBody: parsed.html || undefined,
        date: parsed.date?.toISOString() || mail.timestamp,
        attachments: (parsed.attachments || []).map((att) => ({
          filename: att.filename || 'unnamed',
          contentType: att.contentType,
          size: att.size,
          content: att.content.toString('base64'),
        })),
        spamVerdict: receipt.spamVerdict.status,
        virusVerdict: receipt.virusVerdict.status,
      };

      // Call webhook
      console.log(`Calling webhook for ${mail.messageId}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Webhook failed for ${mail.messageId}: ${response.status} ${errorText}`);
        throw new Error(`Webhook returned ${response.status}`);
      }

      const result = await response.json();
      console.log(`Successfully processed ${mail.messageId}:`, result);

    } catch (error) {
      console.error(`Error processing ${mail.messageId}:`, error);
      throw error; // Let Lambda retry
    }
  }

  return { status: 'ok' };
};
```

**Deploy steps**:
```bash
cd lambda
npm install
zip -r function.zip index.mjs node_modules
```

Then upload:
1. Go to Lambda function → Code tab
2. Click "Upload from" → ".zip file"
3. Upload `function.zip`
4. Click "Save"

### 5.6 Add SES Permission to Invoke Lambda
1. Go to Lambda function → Configuration → Permissions
2. Scroll to "Resource-based policy statements"
3. Click "Add permissions"
4. Select "AWS service"
5. **Service**: `ses.amazonaws.com`
6. **Statement ID**: `AllowSES`
7. **Principal**: `ses.amazonaws.com`
8. **Source account**: Your AWS account ID
9. **Action**: `lambda:InvokeFunction`
10. Click "Save"

---

## Step 6: Create SES Receipt Rule

### 6.1 Create Rule Set
1. Go to SES Console → Email receiving → Rule sets
2. Click "Create rule set"
3. **Rule set name**: `getfamilyassistant-inbound`
4. Click "Create rule set"

### 6.2 Create Rule
1. Click on the rule set → Create rule
2. **Rule name**: `process-all-emails`
3. **Status**: Enabled
4. Click "Next"

**Recipient conditions** (Step 2):
- Leave empty for catch-all on the verified domain
- Or add `inbox.getfamilyassistant.com` to only process emails for that subdomain
- Click "Next"

**Actions** (Step 3):
1. Click "Add new action" → "Deliver to Amazon S3 bucket"
   - **S3 bucket**: `getfamilyassistant-inbound-emails`
   - Leave object key prefix empty
2. Click "Add new action" → "Invoke AWS Lambda function"
   - **Lambda function**: `getfamilyassistant-email-processor`
   - **Invocation type**: Event
3. Click "Next"

**Review** (Step 4):
- Review settings and click "Create rule"

### 6.3 Set as Active Rule Set
1. Go back to Email receiving → Rule sets
2. Click on `getfamilyassistant-inbound`
3. Click "Set as active"

---

## Step 7: Configure App Environment

Add to your app's `.env` file:

```bash
# Hosted Email Webhook
HOSTED_EMAIL_WEBHOOK_SECRET=<same-secret-as-lambda>
```

The domain is configured in code as `inbox.getfamilyassistant.com`.

---

## Step 8: Testing

### 8.1 Test Webhook Locally
```bash
curl -X POST http://localhost:3000/api/email/inbound \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret-here" \
  -d '{
    "messageId": "test-123",
    "recipient": "testuser@inbox.getfamilyassistant.com",
    "from": "sender@example.com",
    "subject": "Test Email",
    "textBody": "This is a test email body",
    "date": "2024-01-15T10:00:00Z",
    "attachments": [],
    "spamVerdict": "PASS",
    "virusVerdict": "PASS"
  }'
```

Expected response for unknown alias:
```json
{"status":"ignored","reason":"unknown_alias"}
```

### 8.2 Test End-to-End
1. Create a user and claim an alias in the app (e.g., `testuser`)
2. Send an email to `testuser@inbox.getfamilyassistant.com`
3. Check CloudWatch logs for Lambda execution
4. Verify email appears in the app

### 8.3 Debug Checklist
If emails aren't arriving:

1. **Check MX records**: `dig MX inbox.getfamilyassistant.com`
2. **Check SES domain verification**: Should show "Verified"
3. **Check SES rule set**: Must be "Active"
4. **Check S3**: Emails should appear in bucket
5. **Check Lambda CloudWatch logs**: Look for errors
6. **Check app logs**: Look for webhook requests

---

## Cost Estimate

| Service | Free Tier | Estimated Monthly Cost |
|---------|-----------|------------------------|
| SES Receiving | 1,000 emails/month | $0.10 per 1,000 after |
| S3 Storage | 5 GB | ~$0.02/GB after |
| Lambda | 1M requests/month | Effectively free |
| **Total** | | **< $1/month** for typical usage |

---

## Security Considerations

1. **Webhook Secret**: Use a strong random secret (32+ characters)
2. **S3 Bucket**: Keep public access blocked
3. **Lambda**: Minimal IAM permissions (S3 read only)
4. **DKIM**: Ensures email authenticity
5. **Spam Filtering**: SES automatically filters spam/virus

---

## Troubleshooting

### "Permission denied" when Lambda reads S3
- Check the Lambda IAM role has the S3 inline policy
- Verify the bucket name matches in the policy and environment variable

### Emails not arriving at SES
- Verify MX records are correct (`dig MX inbox.getfamilyassistant.com`)
- Check domain is verified in SES
- Check rule set is active

### Lambda timeout
- Increase timeout in Lambda configuration (up to 30 seconds)
- Check if webhook endpoint is responding slowly

### Webhook returns 401
- Verify `WEBHOOK_SECRET` matches in Lambda and app
- Check header name is exactly `X-Webhook-Secret`

### Duplicate emails
- This is normal - the app deduplicates by `messageId`
- Lambda may retry on temporary failures
