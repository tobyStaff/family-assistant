// src/routes/authRoutes.ts
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { storeAuth } from '../db/authDb.js';
import { upsertUser, getUser, ensureSuperAdminRoles, updateOnboardingStep, setGmailConnected, setCalendarConnected } from '../db/userDb.js';
import { ensureSubscription } from '../db/subscriptionDb.js';
import { createSession, deleteSession } from '../db/sessionDb.js';
import { encrypt } from '../lib/crypto.js';
import { requireAuth } from '../middleware/session.js';
import type { AuthEntry } from '../types/todo.js';
import type { Role } from '../types/roles.js';
import { isAdmin, isSuperAdmin } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';

/**
 * Minimal scopes for initial login (identity only)
 */
const LOGIN_SCOPES = [
  'openid',
  'email',
  'profile',
];

/**
 * Full scopes including Gmail/Calendar access (granted during onboarding)
 */
const GMAIL_READ_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
  'profile',
];

/**
 * Full scopes including send/calendar/drive (granted incrementally when needed)
 */
const GMAIL_SEND_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
  'profile',
];

/**
 * Calendar scopes for Google Calendar integration (optional feature)
 */
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
  'profile',
];

/**
 * Create OAuth2Client with credentials from environment
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Register authentication routes
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /login
   * Serve login page with "Sign in with Google" button
   */
  fastify.get('/login', async (_request, reply) => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Family Assistant - Login</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #2A5C82 0%, #1E4562 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            font-family: 'Fraunces', Georgia, serif;
            color: #1E4562;
            margin-bottom: 0.5rem;
            font-size: 2rem;
            font-weight: 600;
          }
          p {
            color: #4A6B8A;
            margin-bottom: 2rem;
            font-size: 1rem;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            background: #2A5C82;
            color: white;
            padding: 14px 28px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
            border: none;
            font-size: 16px;
            cursor: pointer;
          }
          .btn:hover {
            background: #1E4562;
            box-shadow: 0 4px 12px rgba(42, 92, 130, 0.3);
          }
          .google-icon {
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 4px;
            padding: 4px;
          }
          @media (max-width: 480px) {
            body {
              padding: 16px;
            }
            .container {
              padding: 2rem 1.5rem;
            }
            h1 {
              font-size: 1.75rem;
            }
            p {
              font-size: 0.9rem;
            }
            .btn {
              padding: 12px 20px;
              font-size: 15px;
              width: 100%;
              justify-content: center;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Family Assistant</h1>
          <p>Manage your family's emails, todos, and calendar in one place</p>
          <a href="/auth/google" class="btn">
            <svg class="google-icon" viewBox="0 0 24 24">
              <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </a>
        </div>
      </body>
      </html>
    `;

    return reply.type('text/html').send(html);
  });

  /**
   * GET /auth/google
   * Initiate OAuth flow - redirect to Google authorization page
   */
  fastify.get('/auth/google', async (_request, reply) => {
    try {
      // Generate CSRF state token
      const state = randomBytes(32).toString('hex');

      // Store state in signed cookie (10 minute expiry)
      (reply as any).setCookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        signed: true,
        path: '/',
      });

      // Create OAuth2 client and generate authorization URL
      // Login uses minimal scopes (identity only) — Gmail permissions granted later during onboarding
      const oauth2Client = createOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'online',
        scope: LOGIN_SCOPES,
        state: state,
      });

      fastify.log.info('Redirecting to Google OAuth (login, identity-only scopes)');
      return reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error initiating OAuth flow');
      return reply.redirect('/auth/error?message=Failed to initiate login');
    }
  });

  /**
   * GET /auth/google/connect-gmail
   * Second OAuth flow to grant Gmail/Calendar permissions (during onboarding)
   */
  fastify.get('/auth/google/connect-gmail', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const state = randomBytes(32).toString('hex');

      (reply as any).setCookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        signed: true,
        path: '/',
      });

      // Mark this as a Gmail connection flow (not a fresh login)
      (reply as any).setCookie('oauth_flow', 'connect-gmail', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
      });

      const oauth2Client = createOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: GMAIL_READ_SCOPES,
        include_granted_scopes: true,
        state: state,
      });

      fastify.log.info('Redirecting to Google OAuth (connect-gmail, read-only scopes)');
      return reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error initiating Gmail connection flow');
      return reply.redirect('/onboarding?error=connect-failed');
    }
  });

  /**
   * GET /auth/google/grant-send
   * Incremental OAuth to add gmail.send permission (before first email)
   */
  fastify.get('/auth/google/grant-send', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const state = randomBytes(32).toString('hex');

      (reply as any).setCookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        signed: true,
        path: '/',
      });

      (reply as any).setCookie('oauth_flow', 'grant-send', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
      });

      const oauth2Client = createOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: GMAIL_SEND_SCOPES,
        include_granted_scopes: true,
        state: state,
      });

      fastify.log.info('Redirecting to Google OAuth (grant-send, incremental)');
      return reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error initiating grant-send flow');
      return reply.redirect('/onboarding?error=grant-send-failed');
    }
  });

  /**
   * GET /auth/google/connect-calendar
   * OAuth flow to grant Google Calendar permissions (optional feature from settings)
   */
  fastify.get('/auth/google/connect-calendar', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const state = randomBytes(32).toString('hex');

      (reply as any).setCookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        signed: true,
        path: '/',
      });

      (reply as any).setCookie('oauth_flow', 'connect-calendar', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
      });

      const oauth2Client = createOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: CALENDAR_SCOPES,
        include_granted_scopes: true,
        state: state,
      });

      fastify.log.info('Redirecting to Google OAuth (connect-calendar)');
      return reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error initiating calendar connection flow');
      return reply.redirect('/settings?error=calendar-connect-failed');
    }
  });

  /**
   * GET /auth/google/callback
   * Handle OAuth callback from Google
   */
  fastify.get('/auth/google/callback', async (request, reply) => {
    try {
      const query = request.query as { code?: string; state?: string; error?: string };

      // Check for OAuth errors
      if (query.error) {
        fastify.log.warn({ error: query.error }, 'OAuth error from Google');
        return reply.redirect(`/auth/error?message=${encodeURIComponent('Authorization denied')}`);
      }

      // Validate required parameters
      if (!query.code || !query.state) {
        fastify.log.warn('Missing code or state in callback');
        return reply.redirect('/auth/error?message=Invalid callback parameters');
      }

      // Verify CSRF state token
      const signedCookie = (request as any).cookies?.oauth_state;
      if (!signedCookie) {
        fastify.log.warn('No oauth_state cookie found');
        return reply.redirect('/auth/error?message=Invalid state parameter');
      }

      // Unsign the cookie to get the original state value
      const unsignResult = (request as any).unsignCookie(signedCookie);
      if (!unsignResult.valid) {
        fastify.log.warn('Invalid cookie signature');
        return reply.redirect('/auth/error?message=Invalid state parameter');
      }

      const storedState = unsignResult.value;
      if (storedState !== query.state) {
        fastify.log.warn({ storedState, receivedState: query.state }, 'CSRF state mismatch');
        return reply.redirect('/auth/error?message=Invalid state parameter');
      }

      // Clear state cookie
      (reply as any).clearCookie('oauth_state');

      // Detect which OAuth flow this is
      const oauthFlow = (request as any).cookies?.oauth_flow;
      const isGmailConnect = oauthFlow === 'connect-gmail';
      const isGrantSend = oauthFlow === 'grant-send';
      const isCalendarConnect = oauthFlow === 'connect-calendar';

      // Clear flow cookie
      (reply as any).clearCookie('oauth_flow', { path: '/' });

      // Exchange authorization code for tokens
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(query.code);

      // Get user info from id_token
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID!,
      });
      const payload = ticket.getPayload();

      if (!payload || !payload.sub || !payload.email) {
        fastify.log.error('Invalid id_token payload');
        return reply.redirect('/auth/error?message=Invalid user information');
      }

      const userId = payload.sub;
      const email = payload.email;
      const name = payload.name;
      const pictureUrl = payload.picture;

      fastify.log.info({ userId, email, isGmailConnect, isGrantSend, isCalendarConnect, hasRefreshToken: !!tokens.refresh_token }, 'User authenticated successfully');

      // Store OAuth tokens if we received a refresh token (Gmail connect flow)
      if (tokens.refresh_token) {
        const encryptedRefreshToken = encrypt(tokens.refresh_token);
        const refreshTokenData = `${encryptedRefreshToken.iv}:${encryptedRefreshToken.content}`;

        let accessTokenData: string | undefined;
        if (tokens.access_token) {
          const encryptedAccessToken = encrypt(tokens.access_token);
          accessTokenData = `${encryptedAccessToken.iv}:${encryptedAccessToken.content}`;
        }

        const authEntry: AuthEntry = {
          user_id: userId,
          refresh_token: refreshTokenData,
          access_token: accessTokenData,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        };
        storeAuth(authEntry);
      }

      // Upsert user profile
      upsertUser({
        user_id: userId,
        email: email,
        name: name,
        picture_url: pictureUrl,
      });

      // Ensure super admin gets all roles
      ensureSuperAdminRoles(email);

      // Ensure subscription record exists (creates FREE tier for new users)
      ensureSubscription(userId);

      // Handle Gmail connection flow — user already has a session
      if (isGmailConnect) {
        setGmailConnected(userId, true);
        updateOnboardingStep(userId, 3); // Step 3: Gmail connected
        fastify.log.info({ userId }, 'Gmail connected during onboarding');
        return reply.redirect('/onboarding');
      }

      // Handle grant-send flow — tokens updated, redirect back to onboarding
      if (isGrantSend) {
        fastify.log.info({ userId }, 'Gmail send permission granted during onboarding');
        return reply.redirect('/onboarding?send_granted=1');
      }

      // Handle calendar connection flow — from settings page
      if (isCalendarConnect) {
        setCalendarConnected(userId, true);
        fastify.log.info({ userId }, 'Google Calendar connected from settings');
        return reply.redirect('/settings?calendar_connected=1');
      }

      // Fresh login flow — create session
      const existingUser = getUser(userId);
      fastify.log.info({ userId, email, onboardingStep: existingUser?.onboarding_step, gmailConnected: existingUser?.gmail_connected }, 'Login: checking onboarding state');

      // Create session (30 days expiry)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const sessionId = createSession(userId, expiresAt);

      // Set session cookie
      (reply as any).setCookie('session_id', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
        signed: true,
        path: '/',
      });

      fastify.log.info({ userId, sessionId }, 'Session created successfully');

      // If new user (onboarding not complete), set step 1 and redirect to onboarding
      if (!existingUser || (existingUser.onboarding_step ?? 0) < 5) {
        if (!existingUser || (existingUser.onboarding_step ?? 0) === 0) {
          updateOnboardingStep(userId, 1); // Step 1: Account created
        }
        return reply.redirect('/onboarding');
      }

      // Existing fully-onboarded user — go to dashboard
      return reply.redirect('/dashboard');
    } catch (error) {
      fastify.log.error({ err: error }, 'Error handling OAuth callback');
      return reply.redirect('/auth/error?message=Authentication failed');
    }
  });

  /**
   * GET /dashboard
   * Protected dashboard page showing user info
   */
  fastify.get('/dashboard', async (request, reply) => {
    // Check if user is authenticated
    const realUserId = (request as any).userId;

    if (!realUserId) {
      return reply.redirect('/login');
    }

    // Get user profile
    const { getUser: getUser_ } = await import('../db/userDb.js');
    const realUser = getUser_(realUserId);

    if (!realUser) {
      fastify.log.warn({ userId: realUserId }, 'User not found in database');
      return reply.redirect('/login');
    }

    // Redirect to onboarding if not complete
    if ((realUser.onboarding_step ?? 0) < 5) {
      return reply.redirect('/onboarding');
    }

    // Get user roles
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const userIsAdmin_ = isAdmin(userRoles);

    // Check for impersonation
    const impersonatingUserId = (request as any).impersonatingUserId;
    const effectiveUserId = impersonatingUserId || realUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

    // Get upcoming events for effective user
    const { getUpcomingEvents } = await import('../db/eventDb.js');
    const upcomingEvents = getUpcomingEvents(effectiveUserId, 7).slice(0, 5);

    // Import dashboard content generators
    const { renderDashboardContent, renderDashboardScripts } = await import('../templates/dashboardContent.js');

    // Generate dashboard content
    const content = renderDashboardContent({
      userIsAdmin: userIsAdmin_,
      upcomingEvents,
    });

    const scripts = renderDashboardScripts(userIsAdmin_);

    // Render with layout
    const html = renderLayout({
      title: 'Dashboard',
      currentPath: '/dashboard',
      user: {
        name: realUser.name,
        email: realUser.email,
        picture_url: realUser.picture_url,
      },
      userRoles,
      impersonating: effectiveUser ? {
        email: effectiveUser.email,
        name: effectiveUser.name,
      } : null,
      content,
      scripts,
    });

    return reply.type('text/html').send(html);
  });

  /**
   * POST /logout
   * Clear session and redirect to login
   */
  fastify.post('/logout', async (request, reply) => {
    try {
      const sessionId = (request as any).cookies?.session_id;

      if (sessionId) {
        // Delete session from database
        const deleted = deleteSession(sessionId);
        fastify.log.info({ sessionId, deleted }, 'Session deleted');
      }

      // Clear session cookie
      (reply as any).clearCookie('session_id');

      return reply.redirect('/login');
    } catch (error) {
      fastify.log.error({ err: error }, 'Error during logout');
      return reply.redirect('/login');
    }
  });

  /**
   * GET /auth/error
   * Show error page with message
   */
  fastify.get('/auth/error', async (request, reply) => {
    const query = request.query as { message?: string };
    const message = query.message || 'Authentication failed';

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authentication Error</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #FAF9F6;
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            box-shadow: 0 8px 30px rgba(42, 92, 130, 0.12);
            text-align: center;
            max-width: 400px;
          }
          .error-icon {
            font-size: 64px;
            margin-bottom: 1rem;
          }
          h1 {
            font-family: 'Fraunces', Georgia, serif;
            color: #E53935;
            margin-bottom: 1rem;
            font-size: 1.5rem;
            font-weight: 600;
          }
          p {
            color: #4A6B8A;
            margin-bottom: 2rem;
          }
          a {
            display: inline-block;
            background: #2A5C82;
            color: white;
            padding: 14px 28px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
          }
          a:hover {
            background: #1E4562;
            box-shadow: 0 4px 12px rgba(42, 92, 130, 0.3);
          }
          @media (max-width: 480px) {
            body {
              padding: 16px;
            }
            .container {
              padding: 2rem 1.5rem;
            }
            .error-icon {
              font-size: 48px;
            }
            h1 {
              font-size: 1.25rem;
            }
            a {
              width: 100%;
              text-align: center;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">⚠️</div>
          <h1>Authentication Error</h1>
          <p>${message}</p>
          <a href="/login">Try Again</a>
        </div>
      </body>
      </html>
    `;

    return reply.type('text/html').send(html);
  });

}
