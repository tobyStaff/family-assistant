This is the **Security Architecture Specification** for your developer. It is designed to meet the **CASA Tier 2** requirements while keeping your infrastructure "1-Man Business" friendly.

You can hand this entire document to your AI developer to ensure they build the system correctly from day one.

---

# **Technical Spec: Family Assistant Security Architecture (Tier 2 Compliant)**

**Objective:** Securely handle Google Restricted Scopes (`gmail.readonly`) to pass automated DAST/SAST scans and annual Google Security Assessments.

## **1. Data Flow & Trust Boundaries**

Your app must treat Gmail data as "Toxic Waste"—it should be handled with care, processed quickly, and never stored in its raw form longer than necessary.

* **Boundary A (User to Frontend):** All traffic must be forced over **TLS 1.3**. Implement **HSTS** (HTTP Strict Transport Security) with a `max-age` of at least 1 year.
* **Boundary B (Backend to Google):** Use the official Google API Client Libraries. Never manually construct OAuth requests.
* **Boundary C (App to Database):** The database must sit in a private subnet. No public IP address.

---

## **2. Token Management (The "Golden Key" Security)**

Google auditors look closely at how you store **Refresh Tokens**. If these are leaked, an attacker has permanent access to the user's inbox.

* **Encryption at Rest:** Refresh tokens must be encrypted before being saved to the database. Use **AES-256-GCM**.
* **Secret Management:** Do *not* store encryption keys in your code or `.env` files. Use a dedicated service like **AWS Secrets Manager**, **Google Secret Manager**, or **HashiCorp Vault**.
* **Token Rotation:** Implement Refresh Token Rotation. When a new access token is requested, the old refresh token should be invalidated.
* **Storage:** Never store Access or Refresh tokens in the browser's `localStorage` or `sessionStorage`. Use **HttpOnly, Secure, SameSite=Strict** cookies for session management.

---

## **3. Data Classification & Persistence**

To pass a Tier 2 scan, you must prove you are following the "Least Privilege" and "Data Minimization" principles.

| Data Type | Storage Requirement | Retention Policy |
| --- | --- | --- |
| **Raw Email Body** | **In-Memory Only.** Do not save to DB. | Deleted immediately after AI processing. |
| **AI Summaries** | Encrypted at rest (AES-256). | Retained while the user is active. |
| **User Metadata** | Standard DB encryption. | Permanent (until account deletion). |
| **PII (Phone/Address)** | Row-level encryption. | Permanent. |

---

## **4. Mandatory Security Headers & Config**

Your developer must ensure the following headers are present on every API response to pass the automated **OWASP ZAP** scan:

* `Content-Security-Policy`: Restrict scripts to your own domain.
* `X-Content-Type-Options`: `nosniff`.
* `X-Frame-Options`: `DENY` or `SAMEORIGIN`.
* `Referrer-Policy`: `strict-origin-when-cross-origin`.

---

## **5. The "Limited Use" Policy (Legal Requirement)**

Google requires a specific "Limited Use" disclosure in your Privacy Policy. Your developer must ensure this text is visible on your site before the scan:

> *"Family Assistant's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements."*

---

## **6. Developer Action Plan for the "Godalming Lab"**

1. **Isolation:** Build the production environment on a platform with built-in compliance (e.g., **Google Cloud Platform** or **AWS**).
2. **Self-Scan:** Before applying for Tier 2, run a **DAST** scan using the `owasp/zap2docker-stable` image against a staging environment.
3. **Audit Log:** Implement a log that tracks every time your AI "reads" a user's email. This is crucial for the manual review part of Tier 2.

---

### **Cost & Timeline for the Dev**

* **Build Time:** Adding these security layers usually adds **15-20%** to the initial backend dev time.
* **Scan Cost:** Authorized labs like **TAC Security** or **Fluid Attacks** offer Tier 2 "Self-Scan" validation for roughly **$500–$1,000/year** (significant discount over the Tier 3 $15k manual audit).

### **Next Step**

Would you like me to **draft the "User Consent" screen copy**?
Because you are reading private emails, the way you ask for permission is legally sensitive. I can write the copy that builds trust without scaring the user away with "Google's scary warnings."