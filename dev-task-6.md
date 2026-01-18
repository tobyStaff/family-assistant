# Dev Task 6
## Security Hardening

Improve session and request security:

1. **Secure cookies in production** - Ensure `secure: true` on session cookies so they're only sent over HTTPS

2. **CSRF protection** - Add CSRF tokens for state-changing operations (POST, DELETE, etc.)

3. **Session management** - Add session expiry and rotation after sensitive actions
