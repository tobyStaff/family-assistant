# AWS Setup: SES Outbound Email

One-time setup to allow the app to send daily summaries via SES.

**Region:** eu-north-1 (Stockholm) for all steps

---

## 1. Create IAM User for Sending

1. Go to **IAM Console** → **Users** → **Create user**
2. **User name:** `inbox-manager-ses-sender`
3. Click **Next** (skip permissions for now)
4. Click **Create user**

---

## 2. Attach Send Permission

1. Click on the user you just created
2. Click **Add permissions** → **Create inline policy**
3. Click the **JSON** tab and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*"
    }
  ]
}
```

4. Click **Next**
5. **Policy name:** `ses-send-email`
6. Click **Create policy**

---

## 3. Generate Access Keys

1. Still on the user page, click the **Security credentials** tab
2. Scroll to **Access keys** → click **Create access key**
3. **Use case:** Application running outside AWS
4. Click **Next** → **Create access key**
5. **Copy both values now** — the secret is only shown once:
   - Access key ID
   - Secret access key

---

## 4. Add Env Vars to Production

SSH into the VPS and edit the `.env` file:

```bash
nano /app/inbox-manager/.env
```

Add these lines:

```bash
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=<your-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
SES_FROM_DOMAIN=inbox.getfamilyassistant.com
```

Save and exit (`Ctrl+X`, `Y`, `Enter`).

---

## 5. Restart the Container

```bash
cd /app/inbox-manager
docker compose down && docker compose up -d
```

---

## 6. Verify

Once the container is up, test SES sending from the admin panel:

```
POST /admin/test-ses-send
```

Or via curl (replace the cookie with a valid session):

```bash
curl -X POST https://getfamilyassistant.com/admin/test-ses-send \
  -H "Cookie: session_id=YOUR_SESSION_COOKIE"
```

A test email should arrive at your account's email address from `<your-alias>@inbox.getfamilyassistant.com` (or `familybriefing@inbox.getfamilyassistant.com` if no alias is set).

---

## 7. Request SES Production Access (if not already done)

By default SES is in sandbox mode and can only send to verified addresses. To send to any recipient:

1. Go to **SES Console** → **Account dashboard**
2. Click **Request production access**
3. Fill out:
   - **Mail type:** Transactional
   - **Website URL:** `https://getfamilyassistant.com`
   - **Use case description:**
     > We send daily email summaries to parents containing school-related information extracted from their inboxes. Users explicitly opt-in by connecting their email or setting up forwarding. Estimated volume: under 1,000 emails/day initially.
4. Submit — approval usually takes 24–48 hours.
