# Hosted Email Setup - Steps You Can Do Now

These steps don't require SES domain verification to complete.

**Region:** eu-north-1 (Stockholm) for all AWS resources

---

## 1. S3 Bucket ✓ DONE

---

## 2. S3 Bucket Policy

1. Go to **S3 Console** → click on `getfamilyassistant-inbound-emails`
2. Click **Permissions** tab
3. Scroll to **Bucket policy** → click **Edit**
4. Paste this policy (replace `YOUR_ACCOUNT_ID` with your 12-digit account ID):

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

5. Click **Save changes**

---

## 3. S3 Lifecycle Rule

1. Still in your S3 bucket, click **Management** tab
2. Click **Create lifecycle rule**
3. Configure:
   - **Rule name:** `delete-after-7-days`
   - **Rule scope:** Apply to all objects in the bucket
4. Under **Lifecycle rule actions**, check:
   - ✓ Expire current versions of objects
5. Under **Expire current versions of objects**:
   - **Days after object creation:** `7`
6. Click **Create rule**

---

## 4. Generate Webhook Secret

Run this in your terminal:

```bash
openssl rand -hex 32
```

Copy the output. You'll use this value in two places:
- Lambda environment variable: `WEBHOOK_SECRET`
- App environment variable: `HOSTED_EMAIL_WEBHOOK_SECRET`

**Save this somewhere secure - you'll need it in steps 6 and 7.**

---

## 5. Lambda IAM Role

### 5.1 Create the Role

1. Go to **IAM Console** → **Roles** → **Create role**
2. **Trusted entity type:** AWS service
3. **Use case:** Lambda
4. Click **Next**
5. Search and select: `AWSLambdaBasicExecutionRole`
6. Click **Next**
7. **Role name:** `getfamilyassistant-email-processor-role`
8. Click **Create role**

### 5.2 Add S3 Read Permission

1. Click on the role you just created
2. Click **Add permissions** → **Create inline policy**
3. Click **JSON** tab
4. Paste:

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

5. Click **Next**
6. **Policy name:** `s3-read-inbound-emails`
7. Click **Create policy**

---

## 6. Lambda Function

### 6.1 Create Function

1. Go to **Lambda Console** (make sure you're in **eu-north-1**)
2. Click **Create function**
3. Configure:
   - **Function name:** `getfamilyassistant-email-processor`
   - **Runtime:** Node.js 20.x
   - **Architecture:** arm64
4. Expand **Change default execution role**:
   - Select **Use an existing role**
   - Choose: `getfamilyassistant-email-processor-role`
5. Click **Create function**

### 6.2 Configure Settings

1. Go to **Configuration** → **General configuration** → **Edit**
2. Set:
   - **Memory:** 256 MB
   - **Timeout:** 30 seconds
3. Click **Save**

### 6.3 Add Environment Variables

1. Go to **Configuration** → **Environment variables** → **Edit**
2. Add these three variables:

| Key | Value |
|-----|-------|
| `WEBHOOK_URL` | `https://getfamilyassistant.com/api/email/inbound` |
| `WEBHOOK_SECRET` | `<the secret you generated in step 4>` |
| `EMAIL_BUCKET` | `getfamilyassistant-inbound-emails` |

3. Click **Save**

### 6.4 Deploy Code

**Option A: Upload via Console**

1. On your local machine, in the `lambda/` folder:

```bash
cd /Users/tobystafford/Documents/Dev/inbox-manager/lambda
npm install
zip -r function.zip index.mjs node_modules
```

2. In Lambda Console → **Code** tab
3. Click **Upload from** → **.zip file**
4. Upload `function.zip`
5. Click **Save**

**Option B: Paste code directly (if no dependencies needed)**

The Lambda uses `mailparser` which requires npm install, so Option A is recommended.

### 6.5 Add SES Invoke Permission

1. Go to **Configuration** → **Permissions**
2. Scroll to **Resource-based policy statements**
3. Click **Add permissions**
4. Configure:
   - **Select:** AWS service
   - **Service:** `ses.amazonaws.com`
   - **Statement ID:** `AllowSESInvoke`
   - **Principal:** `ses.amazonaws.com`
   - **Source account:** `YOUR_ACCOUNT_ID`
   - **Action:** `lambda:InvokeFunction`
5. Click **Save**

---

## 7. Add Webhook Secret to App

Add to your production environment (e.g., `.env` or hosting platform):

```bash
HOSTED_EMAIL_WEBHOOK_SECRET=<the secret you generated in step 4>
```

Deploy the app with this new env var.

---

## 8. MX Record

Add this DNS record for `inbox.getfamilyassistant.com`:

| Type | Name | Value | Priority | TTL |
|------|------|-------|----------|-----|
| MX | inbox | inbound-smtp.eu-north-1.amazonaws.com | 10 | 3600 |

**Note:** The exact format depends on your DNS provider:
- Some want `inbox` as the name
- Some want `inbox.getfamilyassistant.com`
- Some want just the subdomain without the domain

**Verify it's working:**

```bash
dig MX inbox.getfamilyassistant.com
```

Should show the `inbound-smtp.eu-north-1.amazonaws.com` endpoint.

---

## 9. Test Webhook Locally

Test your app's webhook endpoint with a mock payload:

```bash
curl -X POST http://localhost:3000/api/email/inbound \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_WEBHOOK_SECRET_HERE" \
  -d '{
    "messageId": "test-123",
    "recipient": "testuser@inbox.getfamilyassistant.com",
    "from": "school@example.com",
    "fromName": "Test School",
    "subject": "Test Email",
    "textBody": "This is a test email body for local testing.",
    "date": "2024-01-15T10:00:00Z",
    "attachments": [],
    "spamVerdict": "PASS",
    "virusVerdict": "PASS"
  }'
```

**Expected response (no user with that alias):**
```json
{"status":"ignored","reason":"unknown_alias"}
```

**To test with a real user:**
1. Create a user in your app
2. Set their hosted alias via the settings API or directly in DB
3. Run the curl again with their alias
4. Should return `{"status":"stored","emailId":...}`

---

## What's Next (After Verification)

Once SES domain verification completes:

1. **Create SES Receipt Rule Set**
   - Go to SES Console → Email receiving → Rule sets
   - Create rule set: `getfamilyassistant-inbound`
   - Create rule with S3 + Lambda actions
   - Set as active

2. **Test End-to-End**
   - Send real email to `youralias@inbox.getfamilyassistant.com`
   - Check CloudWatch logs
   - Verify email in app

3. **Request Production Access**
   - SES Console → Account dashboard
   - Request production access to send to non-verified emails
