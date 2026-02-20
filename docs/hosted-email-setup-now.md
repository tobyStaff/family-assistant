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

---

### 10. Create SES Receipt Rule Set

#### 10.1 Create the Rule Set

1. Go to **SES Console** (make sure you're in **eu-north-1**)
2. In the left sidebar, click **Email receiving** → **Rule sets**
3. Click **Create rule set**
4. **Rule set name:** `getfamilyassistant-inbound`
5. Click **Create rule set**

#### 10.2 Create the Receipt Rule

1. Click on your new rule set `getfamilyassistant-inbound`
2. Click **Create rule**

**Step 1 - Rule settings:**
- **Rule name:** `process-all-emails`
- **Status:** Enabled
- Click **Next**

**Step 2 - Recipient conditions:**
- Leave empty for catch-all (receives all emails to `*@inbox.getfamilyassistant.com`)
- Or add specific condition: `inbox.getfamilyassistant.com` to only accept emails for that subdomain
- Click **Next**

**Step 3 - Actions (add in this order):**

1. Click **Add new action** → **Deliver to Amazon S3 bucket**
   - **S3 bucket:** `getfamilyassistant-inbound-emails`
   - **Object key prefix:** leave empty
   - Click **Add action**

2. Click **Add new action** → **Invoke AWS Lambda function**
   - **Lambda function:** `getfamilyassistant-email-processor`
   - **Invocation type:** Event (asynchronous)
   - If prompted to add permissions, click **Add permissions** to allow SES to invoke Lambda
   - Click **Add action**

3. Click **Next**

**Step 4 - Review:**
- Review all settings
- Click **Create rule**

#### 10.3 Set Rule Set as Active

1. Go back to **Email receiving** → **Rule sets**
2. Select `getfamilyassistant-inbound`
3. Click **Set as active**
4. Confirm when prompted

**Note:** Only one rule set can be active at a time. If you had another active rule set, it will be deactivated.

#### 10.4 Verify Setup

Your email flow is now:
```
Email arrives → SES receives → S3 stores raw email → Lambda invoked → Lambda calls webhook → App stores email
```

---

### 11. Test End-to-End

1. **Create a test alias in your app:**
   ```bash
   # Via API (while logged in) or directly in DB:
   sqlite3 data/inbox.db "UPDATE users SET hosted_email_alias = 'testalias' WHERE email = 'your@email.com';"
   ```

2. **Send a test email:**
   - From any email account, send to `testalias@inbox.getfamilyassistant.com`
   - Use a clear subject like "SES Test Email"

3. **Check CloudWatch Logs:**
   - Go to **CloudWatch** → **Log groups**
   - Find `/aws/lambda/getfamilyassistant-email-processor`
   - Look for recent log stream
   - Should see: "Processing email...", "Calling webhook...", "Successfully processed..."

4. **Check your app:**
   - The email should appear in the stored emails for that user
   - Check your app logs for "Inbound email stored successfully"

5. **Troubleshooting:**
   - No logs in CloudWatch? → Check SES rule is active, MX records correct
   - Lambda error? → Check S3 bucket name, IAM permissions
   - Webhook failed? → Check WEBHOOK_URL and WEBHOOK_SECRET match

---

### 12. Request Production Access (For Outbound)

To send emails to non-verified recipients:

1. Go to **SES Console** → **Account dashboard**
2. In the "Your Amazon SES account is in the sandbox" banner, click **Request production access**
3. Fill out the form:
   - **Mail type:** Transactional
   - **Website URL:** `https://getfamilyassistant.com`
   - **Use case description:** Example:
     > "We send daily email summaries to parents containing school-related information extracted from their inboxes. Users explicitly opt-in by connecting their email or setting up forwarding. Estimated volume: under 1,000 emails/day initially."
4. Submit and wait for approval (usually 24-48 hours)
