# Cookie Policy

**Effective Date:** 2026-05-16

This document records the cookies set by the `inbox-manager` web application, what they store, why they are set, and how they relate to UK/EU GDPR obligations.

## Cookies set by this application

| Name | Purpose | Set by | Lifetime | HttpOnly | Secure | First/Third-party | Personal data |
|---|---|---|---|---|---|---|---|
| `session_id` | Authenticated session identifier. Issued after a successful Google sign-in via `/auth/google`. Required to access the user's inbox dashboard, settings, and APIs. | Server, on auth callback | 30 days (rolling) | Yes | Yes (prod only) | First-party | Indirectly — maps to a row in the `sessions` table that links to a `users` row containing the user's email |
| `impersonate_user_id` | Active impersonation target. Only set when a SUPER_ADMIN account uses the impersonation feature. Allows the admin to view the app as another user without logging out. | Server, when impersonation begins | Until impersonation ends | Yes | Yes (prod only) | First-party | Yes — references another user's id |
| `tracking_vid` | Anonymous analytics identifier. Set on the first interaction with the marketing landing page so multiple events from the same visitor can be linked together (e.g. pageview → scroll → CTA click). Used to debug the conversion funnel between landing-page arrivals and sign-ups. | Server, on first `POST /api/track` | 1 year | Yes | Yes (prod only) | First-party | No PII captured against this id. The cookie value is a random UUID with no link to email, name, or any other personal identifier unless and until the visitor signs up and an authenticated `user_id` is recorded alongside future events. |

No third-party cookies are set directly by this application. Note that the Meta Pixel (Facebook conversion tracking) loaded on the landing page does set its own first-party cookies (e.g. `_fbp`) under the `getfamilyassistant.com` domain; these are governed by Meta's own data practices.

## Legal basis for the `tracking_vid` cookie

Under UK/EU GDPR and the Privacy and Electronic Communications Regulations (PECR), cookies that are **strictly necessary** to deliver a service requested by the user (e.g. `session_id`) do not require consent. Cookies set for **analytics** purposes — including `tracking_vid` — fall outside the strictly-necessary exemption.

The analytics events recorded against `tracking_vid` are:

- First-party only (data stays inside the application's own SQLite database)
- Not shared with any third party
- Used solely for first-party product analytics — measuring the landing-page conversion funnel and improving the page
- Stored against a random UUID, not against any personally-identifying information
- Linked to a `user_id` only after the visitor voluntarily signs up

Most regulators distinguish between low-risk first-party analytics of this kind and tracking that profiles users across sites. The ICO's current guidance (UK) treats first-party analytics as lower risk than third-party tracking, but still recommends transparent disclosure and, where practical, a way for visitors to opt out.

**Until a wider EU/UK audience is targeted, this application relies on a transparency-based approach: this policy document, plus a public cookie banner being deferred while the product is in early-access with a small founder cohort.** When the product begins paid acquisition into the EU, the recommended next steps are either:

1. Add a consent banner (e.g. `cookieconsent` or similar) that defers `POST /api/track` calls until the visitor accepts analytics cookies, OR
2. Re-architect the visitor identifier to use IP+UA-hash rather than a cookie (no persistent identifier on the device), accepting the loss of cross-session visitor linking.

## Retention

| Data | Retention |
|---|---|
| `tracking_vid` cookie value | 1 year from last server write |
| `tracking_events` table rows | Indefinite (no automatic cleanup currently). Recommend a quarterly job to delete rows older than 12 months once the table grows beyond useful size. |
| `session_id` rows | Deleted by the daily `session-cleanup` cron job when expired |

## Visitor rights

Visitors can:

- Block or delete the `tracking_vid` cookie at any time via their browser's cookie controls. Doing so will cause subsequent visits to be recorded as a new anonymous visitor.
- Request deletion of analytics data linked to their `user_id` (if signed up) by contacting the email in the footer.

## Where the code lives

For developers reviewing or removing the tracking system:

- Cookie set in `src/tracking/trackingRoutes.ts` (`tracking_vid`)
- Schema and queries in `src/tracking/trackingDb.ts`
- Client-side instrumentation in `src/tracking/trackingScript.ts`

To remove tracking entirely:

1. Delete `await registerTracking(fastify);` from `src/app.ts`
2. Delete `${trackingScript}` from `src/templates/landingPage.ts`
3. Delete the `src/tracking/` directory
4. Optionally `DROP TABLE tracking_events;`

The `session_id` and `impersonate_user_id` cookies are not analytics — they are operationally required and stay regardless of any tracking-system changes.
