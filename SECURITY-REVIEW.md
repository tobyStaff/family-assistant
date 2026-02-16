# Security Architecture Review: CASA Tier 2 Compliance

**Date:** 2026-02-11
**Reviewed Against:** `security-architecture-requirements.md`
**Codebase:** Inbox Manager (Family Assistant)

---

## Executive Summary

| Category | Status | Risk Level |
|----------|--------|------------|
| Token Management | Partial | Medium |
| Data Persistence | Non-Compliant | **Critical** |
| Security Headers | Non-Compliant | **High** |
| Session Management | Compliant | Low |
| Audit Logging | Non-Compliant | **Critical** |
| Limited Use Disclosure | Non-Compliant | **High** |

**Overall Assessment:** The codebase has foundational security (token encryption, session management) but fails to meet several CASA Tier 2 requirements. Significant work is needed before submitting for Google security assessment.

---

## 1. Token Management

### Requirement (Section 2)
> - Encryption at Rest: Refresh tokens must be encrypted using AES-256-GCM
> - Secret Management: Do not store encryption keys in .env files. Use AWS Secrets Manager, Google Secret Manager, or HashiCorp Vault
> - Token Rotation: Implement refresh token rotation
> - Storage: Use HttpOnly, Secure, SameSite=Strict cookies

### Current Implementation

**Encryption:** `src/lib/crypto.ts`
- Algorithm: AES-256-CBC (not GCM as specified)
- Key derivation: Scrypt with persistent salt
- Format: `iv:ciphertext` stored in database

**Secret Storage:** Environment variable `ENCRYPTION_SECRET`
- Minimum 16 characters enforced
- Salt persisted to `/data/crypto_salt` file

**Token Storage:** `src/db/authDb.ts`
```typescript
const refreshToken = decryptToken(authEntry.refresh_token);
const accessToken = authEntry.access_token ? decryptToken(authEntry.access_token) : undefined;
```

**Cookie Settings:** `src/app.ts`
```typescript
parseOptions: {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',  // Spec requires 'strict'
}
```

### Gap Analysis

| Requirement | Status | Notes |
|-------------|--------|-------|
| AES-256-GCM encryption | Partial | Uses AES-256-CBC instead |
| External secret management | No | Uses .env file |
| Token rotation | No | Not implemented |
| HttpOnly cookies | Yes | Implemented |
| Secure flag | Yes | Production only |
| SameSite=Strict | Partial | Uses 'lax' instead of 'strict' |

### Recommendations
1. Consider migrating to AES-256-GCM for authenticated encryption
2. Move `ENCRYPTION_SECRET` to Google Secret Manager or AWS Secrets Manager
3. Implement refresh token rotation on token refresh
4. Change `sameSite` from `'lax'` to `'strict'`

---

## 2. Data Classification & Persistence

### Requirement (Section 3)
> | Data Type | Storage Requirement |
> |-----------|---------------------|
> | Raw Email Body | **In-Memory Only.** Do not save to DB. |
> | AI Summaries | Encrypted at rest (AES-256) |
> | PII (Phone/Address) | Row-level encryption |

### Current Implementation

**Email Storage:** `src/db/emailDb.ts`, `src/utils/emailStorageService.ts`

```typescript
// emailStorageService.ts - Email bodies ARE stored
export interface StoredEmail {
  body_text?: string;           // STORED IN PLAINTEXT
  snippet?: string;             // STORED IN PLAINTEXT
  attachment_content?: string;  // STORED IN PLAINTEXT
}
```

**Database Schema:** `src/db/db.ts`
- `stored_emails` table contains `body_text` column
- No encryption applied to email content
- No retention policy or automatic cleanup

### Gap Analysis

| Requirement | Status | Notes |
|-------------|--------|-------|
| Raw email body in-memory only | **FAIL** | Stored in database |
| Email body never persisted | **FAIL** | Persisted indefinitely |
| AI summaries encrypted | **FAIL** | Stored in plaintext |
| PII row-level encryption | **FAIL** | Not implemented |

### Marketing Discrepancy

The landing page (`src/templates/landingPageContent.ts`) claims:
> "Clean Room Processing (Data purged after use)"

This is **not accurate** - email bodies and attachments are persisted in the database.

### Recommendations
1. **Critical:** Refactor to process emails in-memory only
2. Store only AI-generated summaries, not raw email content
3. Implement encryption for stored summaries
4. Add data retention policy with automatic cleanup
5. Update marketing copy to reflect actual data handling

---

## 3. Security Headers

### Requirement (Section 4)
> Your developer must ensure the following headers are present on every API response:
> - `Content-Security-Policy`: Restrict scripts to your own domain
> - `X-Content-Type-Options`: nosniff
> - `X-Frame-Options`: DENY or SAMEORIGIN
> - `Referrer-Policy`: strict-origin-when-cross-origin

### Requirement (Section 1)
> Implement HSTS (HTTP Strict Transport Security) with max-age of at least 1 year

### Current Implementation

**No security headers middleware found.** Searched:
- `src/app.ts` - No helmet or security header configuration
- No `@fastify/helmet` in dependencies

### Gap Analysis

| Header | Status | Required Value |
|--------|--------|----------------|
| Content-Security-Policy | **MISSING** | Restrict to own domain |
| X-Content-Type-Options | **MISSING** | nosniff |
| X-Frame-Options | **MISSING** | DENY or SAMEORIGIN |
| Referrer-Policy | **MISSING** | strict-origin-when-cross-origin |
| Strict-Transport-Security | **MISSING** | max-age=31536000; includeSubDomains |

### Recommendations

Add `@fastify/helmet` to `src/app.ts`:

```typescript
import helmet from '@fastify/helmet';

await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
```

---

## 4. Session Management

### Current Implementation

**Session Creation:** `src/db/sessionDb.ts`
```typescript
const sessionId = randomBytes(32).toString('hex');  // 256-bit session ID
```

**Session Validation:** `src/middleware/session.ts`
- Signed cookies prevent tampering
- Automatic expiration cleanup
- Impersonation scoped to SUPER_ADMIN role

**Cookie Configuration:**
- HttpOnly: Yes
- Secure: Yes (production)
- SameSite: lax
- Max Age: 30 days

### Assessment: **COMPLIANT**

Session management is well-implemented with:
- Cryptographically secure session IDs
- Server-side session storage
- Signed cookies
- Proper expiration handling

### Minor Improvements
- Consider reducing 30-day session timeout
- Add session fingerprinting (IP/User-Agent validation)

---

## 5. Audit Logging

### Requirement (Section 6)
> Implement a log that tracks every time your AI "reads" a user's email. This is crucial for the manual review part of Tier 2.

### Current Implementation

**Existing Logging:**
- Action token requests (partial token logged)
- Email fetch counts
- Authentication failures
- Cron job triggers

**Missing Audit Events:**
- User email access/reads
- Who accessed which email
- AI processing of email content
- Data exports
- Impersonation start/stop
- Token refresh events

### Gap Analysis

| Audit Event | Status |
|-------------|--------|
| Email read by user | **MISSING** |
| Email processed by AI | **MISSING** |
| Data export | **MISSING** |
| Impersonation events | **MISSING** |
| Token operations | Partial |

### Recommendations

Create `src/utils/auditLogger.ts`:

```typescript
interface AuditEvent {
  timestamp: Date;
  user_id: string;
  action: 'email_read' | 'email_processed' | 'data_export' | 'impersonate_start' | 'impersonate_end';
  resource_id?: string;
  metadata?: Record<string, any>;
}

export function logAuditEvent(event: AuditEvent): void {
  // Log to database and/or external service
}
```

Add audit logging to:
- `src/utils/emailStorageService.ts` - When emails are fetched
- `src/parsers/eventTodoExtractor.ts` - When AI processes emails
- `src/middleware/session.ts` - Impersonation events

---

## 6. Limited Use Disclosure

### Requirement (Section 5)
> Google requires a specific "Limited Use" disclosure in your Privacy Policy:
>
> *"Family Assistant's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."*

### Current Implementation

**Privacy Policy Link:** `src/templates/landingPageContent.ts`
```html
<a href="/privacy">Privacy Policy</a>
```

**Route Status:** `/privacy` and `/terms` routes are **NOT IMPLEMENTED** (404)

**Limited Use Text:** **NOT PRESENT** anywhere in codebase

### Gap Analysis

| Requirement | Status |
|-------------|--------|
| Privacy Policy accessible | **FAIL** - 404 |
| Terms of Service accessible | **FAIL** - 404 |
| Limited Use disclosure | **FAIL** - Missing |
| Google API Policy link | **FAIL** - Missing |

### Recommendations

1. Create `/privacy` route with full privacy policy
2. Create `/terms` route with terms of service
3. Add Limited Use disclosure to:
   - Privacy Policy page
   - OAuth consent screen
   - Landing page footer

---

## 7. Infrastructure (Not Verified)

### Requirement (Section 1)
> - All traffic must be forced over TLS 1.3
> - Database must sit in a private subnet. No public IP address.

### Requirements (Section 6)
> Build the production environment on a platform with built-in compliance (e.g., Google Cloud Platform or AWS)

### Status: Unable to Verify

Infrastructure configuration is not in the codebase. Verify externally:
- [ ] TLS 1.3 enforced at load balancer/proxy level
- [ ] Database has no public IP
- [ ] Database in private subnet/VPC
- [ ] Production on GCP or AWS with compliance features

---

## Summary: Required Actions

### Critical (Must Fix for Tier 2)

1. **Stop persisting raw email bodies** - Process in-memory only
2. **Add all security headers** - Install @fastify/helmet
3. **Implement audit logging** - Track all email access
4. **Add Limited Use disclosure** - Required by Google

### High Priority

5. **Create privacy policy page** - Currently 404
6. **Create terms of service page** - Currently 404
7. **Update marketing copy** - "Data purged after use" is inaccurate

### Medium Priority

8. **Move secrets to Secret Manager** - Currently in .env
9. **Implement token rotation** - Not currently implemented
10. **Change SameSite to 'strict'** - Currently 'lax'

### Low Priority

11. **Consider AES-256-GCM** - Currently using CBC mode
12. **Reduce session timeout** - 30 days is long
13. **Add session fingerprinting** - IP/User-Agent validation

---

## Pre-Submission Checklist

Before applying for CASA Tier 2 assessment:

- [ ] Raw email bodies never stored in database
- [ ] All security headers present (run OWASP ZAP scan)
- [ ] Audit log tracks every AI email read
- [ ] Limited Use disclosure visible on site
- [ ] Privacy policy accessible at /privacy
- [ ] Terms of service accessible at /terms
- [ ] HSTS header with 1-year max-age
- [ ] Database in private subnet (verify infrastructure)
- [ ] TLS 1.3 enforced (verify infrastructure)
- [ ] Secrets in external secret manager

---

## Cost/Timeline Estimate

Per security-architecture-requirements.md:
> Adding these security layers usually adds 15-20% to the initial backend dev time.

**Estimated work to reach compliance:**
- Security headers: 1-2 hours
- Audit logging: 4-6 hours
- In-memory email processing refactor: 8-16 hours
- Privacy/Terms pages: 2-4 hours
- Secret manager migration: 2-4 hours
- Token rotation: 4-6 hours

**Total: 20-40 hours of development work**

---

*Review completed by Claude Code*
