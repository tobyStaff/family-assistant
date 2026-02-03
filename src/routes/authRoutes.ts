// src/routes/authRoutes.ts
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { storeAuth } from '../db/authDb.js';
import { upsertUser, getUser, ensureSuperAdminRoles, updateOnboardingStep, setGmailConnected } from '../db/userDb.js';
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
        <title>Inbox Manager - Login</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            color: #333;
            margin-bottom: 0.5rem;
            font-size: 2rem;
          }
          p {
            color: #666;
            margin-bottom: 2rem;
            font-size: 1rem;
          }
          .btn {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            background: #4285f4;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            transition: background 0.2s;
            border: none;
            font-size: 16px;
            cursor: pointer;
          }
          .btn:hover {
            background: #357ae8;
          }
          .google-icon {
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 2px;
            padding: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Inbox Manager</h1>
          <p>Manage your emails, todos, and calendar in one place</p>
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

      fastify.log.info({ userId, email, isGmailConnect }, 'User authenticated successfully');

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

      // Handle Gmail connection flow — user already has a session
      if (isGmailConnect) {
        setGmailConnected(userId, true);
        updateOnboardingStep(userId, 2); // Step 2: Gmail connected
        fastify.log.info({ userId }, 'Gmail connected during onboarding');
        return reply.redirect('/onboarding');
      }

      // Handle grant-send flow — tokens updated, redirect back to onboarding
      if (isGrantSend) {
        fastify.log.info({ userId }, 'Gmail send permission granted during onboarding');
        return reply.redirect('/onboarding?send_granted=1');
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
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          .error-icon {
            font-size: 64px;
            margin-bottom: 1rem;
          }
          h1 {
            color: #dc3545;
            margin-bottom: 1rem;
            font-size: 1.5rem;
          }
          p {
            color: #666;
            margin-bottom: 2rem;
          }
          a {
            display: inline-block;
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            transition: background 0.2s;
          }
          a:hover {
            background: #0056b3;
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

  /**
   * GET /onboarding
   * Child profile onboarding wizard
   */
  fastify.get('/onboarding', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const user = getUser(userId);
    const currentStep = user?.onboarding_step ?? 0;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Setup - Family Assistant</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 900px;
            width: 100%;
            padding: 40px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #f0f0f0;
          }
          h1 {
            font-size: 28px;
            color: #333;
          }
          .back-link {
            color: #667eea;
            text-decoration: none;
            font-size: 14px;
          }
          .back-link:hover {
            text-decoration: underline;
          }

          /* Steps indicator */
          .steps {
            display: flex;
            justify-content: space-between;
            margin-bottom: 40px;
            position: relative;
          }
          .steps::before {
            content: '';
            position: absolute;
            top: 20px;
            left: 0;
            right: 0;
            height: 2px;
            background: #e0e0e0;
            z-index: 0;
          }
          .step {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 1;
            flex: 1;
          }
          .step-number {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #e0e0e0;
            color: #999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            margin-bottom: 8px;
          }
          .step.active .step-number {
            background: #667eea;
            color: white;
          }
          .step.completed .step-number {
            background: #28a745;
            color: white;
          }
          .step-label {
            font-size: 12px;
            color: #666;
            text-align: center;
          }

          /* Content sections */
          .step-content {
            display: none;
          }
          .step-content.active {
            display: block;
          }

          /* Welcome screen */
          .welcome-content {
            text-align: center;
            padding: 40px 0;
          }
          .welcome-icon {
            font-size: 80px;
            margin-bottom: 20px;
          }
          .welcome-content h2 {
            font-size: 24px;
            color: #333;
            margin-bottom: 16px;
          }
          .welcome-content p {
            font-size: 16px;
            color: #666;
            line-height: 1.6;
            margin-bottom: 12px;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
          }
          .feature-list {
            text-align: left;
            max-width: 500px;
            margin: 30px auto;
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
          }
          .feature-list li {
            padding: 8px 0;
            color: #555;
          }

          /* Analysis screen */
          .analysis-content {
            text-align: center;
            padding: 60px 0;
          }
          .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .analysis-status {
            font-size: 18px;
            color: #333;
            margin-bottom: 12px;
          }
          .analysis-detail {
            font-size: 14px;
            color: #666;
          }

          /* Review screen */
          .review-header {
            margin-bottom: 30px;
          }
          .review-header h2 {
            font-size: 22px;
            color: #333;
            margin-bottom: 8px;
          }
          .review-header p {
            color: #666;
            font-size: 14px;
          }
          .child-cards {
            display: grid;
            gap: 20px;
            margin-bottom: 30px;
          }
          .child-card {
            background: #f8f9fa;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            padding: 20px;
            position: relative;
          }
          .child-card.low-confidence {
            border-color: #ffc107;
            background: #fffbf0;
          }
          .confidence-badge {
            position: absolute;
            top: 16px;
            right: 16px;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
          }
          .confidence-high {
            background: #d4edda;
            color: #155724;
          }
          .confidence-medium {
            background: #fff3cd;
            color: #856404;
          }
          .confidence-low {
            background: #f8d7da;
            color: #721c24;
          }
          .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }
          .card-icon {
            font-size: 32px;
          }
          .card-title {
            font-size: 20px;
            font-weight: 600;
            color: #333;
          }
          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
          }
          .form-group {
            margin-bottom: 16px;
          }
          .form-group label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: #555;
            margin-bottom: 6px;
          }
          .form-group input,
          .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
          }
          .form-group input:focus,
          .form-group select:focus {
            outline: none;
            border-color: #667eea;
          }
          .help-text {
            font-size: 12px;
            color: #888;
            margin-top: 4px;
          }
          .example-emails {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e0e0e0;
          }
          .example-emails summary {
            cursor: pointer;
            font-size: 13px;
            color: #667eea;
            font-weight: 500;
            user-select: none;
          }
          .example-emails ul {
            margin-top: 8px;
            padding-left: 20px;
          }
          .example-emails li {
            font-size: 13px;
            color: #666;
            padding: 4px 0;
          }
          .btn-remove-card {
            background: #dc3545;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            margin-top: 12px;
          }
          .btn-remove-card:hover {
            background: #c82333;
          }

          /* Buttons */
          .button-group {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-top: 30px;
          }
          .btn {
            padding: 14px 32px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
          }
          .btn-primary {
            background: #667eea;
            color: white;
          }
          .btn-primary:hover {
            background: #5568d3;
          }
          .btn-primary:disabled {
            background: #ccc;
            cursor: not-allowed;
          }
          .btn-secondary {
            background: #6c757d;
            color: white;
          }
          .btn-secondary:hover {
            background: #5a6268;
          }
          .btn-add {
            background: #28a745;
            color: white;
            padding: 10px 20px;
            font-size: 14px;
          }
          .btn-add:hover {
            background: #218838;
          }

          /* Messages */
          .message {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
          }
          .message.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            display: block;
          }
          .message.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            display: block;
          }
          .message.warning {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeeba;
            display: block;
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 60px 40px;
            background: #f8f9fa;
            border-radius: 12px;
            border: 2px dashed #ddd;
          }
          .empty-state-icon {
            font-size: 64px;
            margin-bottom: 16px;
          }
          .empty-state h3 {
            font-size: 20px;
            color: #333;
            margin-bottom: 8px;
          }
          .empty-state p {
            color: #666;
            font-size: 14px;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Family Assistant</h1>
          </div>

          <div id="message" class="message"></div>
          <!-- debug: onboarding_step=${currentStep} gmail_connected=${user?.gmail_connected} -->

          <!-- Steps indicator -->
          <div class="steps">
            <div class="step ${currentStep >= 1 ? 'active' : ''}" id="step-indicator-1">
              <div class="step-number">1</div>
              <div class="step-label">Connect</div>
            </div>
            <div class="step ${currentStep >= 3 ? 'active' : ''}" id="step-indicator-2">
              <div class="step-number">2</div>
              <div class="step-label">Senders</div>
            </div>
            <div class="step" id="step-indicator-3">
              <div class="step-number">3</div>
              <div class="step-label">Train</div>
            </div>
            <div class="step ${currentStep >= 4 ? 'active' : ''}" id="step-indicator-4">
              <div class="step-number">4</div>
              <div class="step-label">Children</div>
            </div>
          </div>

          <!-- Step 1: Welcome + Connect Gmail -->
          <div class="step-content ${currentStep < 2 ? 'active' : ''}" id="step-welcome">
            <div class="welcome-content">
              <div class="welcome-icon">👋</div>
              <h2>Welcome! Let's set up your family assistant in 4 steps.</h2>
              <p>To build your daily briefing, our AI needs to look for school signals in your inbox.</p>

              <div class="feature-list">
                <strong>What we do:</strong>
                <ul>
                  <li>We only process senders you explicitly approve in the next step</li>
                  <li>We do not read personal or financial emails</li>
                  <li>We extract school events, todos, and key info</li>
                </ul>
              </div>

              <div class="button-group">
                <a href="/auth/google/connect-gmail" class="btn btn-primary" style="text-decoration:none;">Connect your Gmail inbox</a>
              </div>
            </div>
          </div>

          <!-- Step 2: Gmail connected, scan inbox -->
          <div class="step-content ${currentStep === 2 ? 'active' : ''}" id="step-scan">
            <div class="welcome-content">
              <div class="welcome-icon">✅</div>
              <h2>Gmail connected!</h2>
              <p>Now let's scan your inbox to find school and family-related senders.</p>
              <p>You'll choose which senders to include or exclude.</p>

              <div class="button-group">
                <button class="btn btn-primary" onclick="scanInbox()" id="scan-btn">Scan Inbox</button>
              </div>
            </div>
          </div>

          <!-- Step 3: Sender selection -->
          <div class="step-content" id="step-senders">
            <div class="review-header">
              <h2>Select senders to monitor</h2>
              <p>Tap "Include" on senders that contain school or family information. Unselected senders won't be monitored.</p>
            </div>

            <!-- Progress bar -->
            <div id="sender-progress" style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:24px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span id="progress-count" style="font-weight:600;font-size:14px;color:#333;">0 senders included</span>
                <span id="progress-hint" style="font-size:13px;color:#888;">Select senders to monitor</span>
              </div>
              <div style="height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;">
                <div id="progress-bar" style="height:100%;background:#667eea;border-radius:3px;transition:width 0.3s;width:0%;"></div>
              </div>
            </div>

            <div id="sender-list">
              <!-- Sender sections rendered by JS -->
            </div>

            <div class="button-group">
              <button class="btn btn-primary" onclick="saveSenders()" id="save-senders-btn">Confirm sender selection</button>
            </div>
          </div>

          <!-- Step 4: Train AI - grade extracted items -->
          <div class="step-content" id="step-train">
            <div class="review-header">
              <h2>Train your assistant</h2>
              <p>Help us understand what's relevant to you. Grade these extracted items from your emails.</p>
            </div>

            <div id="train-loading" style="text-align:center;padding:40px;">
              <div class="spinner"></div>
              <p style="color:#666;margin-top:16px;">Extracting items from your emails...</p>
            </div>

            <div id="train-items" style="display:none;">
              <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span id="train-progress" style="font-weight:600;font-size:14px;color:#333;">0 of 0 items graded</span>
                  <span style="font-size:13px;color:#888;">Tap Relevant or Not Relevant for each item</span>
                </div>
              </div>

              <div id="train-items-list" class="child-cards"></div>

              <div id="train-empty" style="display:none;text-align:center;padding:40px;background:#f8f9fa;border-radius:12px;border:2px dashed #ddd;">
                <div style="font-size:48px;margin-bottom:16px;">📭</div>
                <h3 style="font-size:18px;color:#333;margin-bottom:8px;">No items found</h3>
                <p style="color:#666;font-size:14px;">We couldn't extract any todos or events from your emails. You can skip this step.</p>
              </div>
            </div>

            <div class="button-group">
              <button class="btn btn-secondary" onclick="skipTraining()" id="skip-train-btn">Skip for now</button>
              <button class="btn btn-primary" onclick="saveTrainingAndContinue()" id="save-train-btn" disabled>Continue</button>
            </div>
          </div>

          <!-- Step 5: Extracting children / analyzing -->
          <div class="step-content" id="step-analyzing">
            <div class="analysis-content">
              <div class="spinner"></div>
              <div class="analysis-status" id="analysis-status">Searching emails from selected senders...</div>
              <div class="analysis-detail" id="analysis-detail">This may take 10-30 seconds</div>
            </div>
          </div>

          <!-- Step 6: Review child profiles -->
          <div class="step-content ${currentStep === 4 ? 'active' : ''}" id="step-children">
            <div class="review-header">
              <h2>Review detected children</h2>
              <p>Edit names, add privacy aliases, and remove any incorrect detections.</p>
            </div>

            <div id="child-cards-container" class="child-cards"></div>

            <button class="btn btn-add" onclick="addManualChild()">+ Add Child Manually</button>

            <div class="button-group">
              <button class="btn btn-primary" onclick="confirmProfiles()" id="confirm-btn">Confirm & Save</button>
            </div>
          </div>

          <!-- Step 7: Complete -->
          <div class="step-content ${currentStep >= 5 ? 'active' : ''}" id="step-complete">
            <div class="welcome-content">
              <div class="welcome-icon">✅</div>
              <h2>Setup almost complete!</h2>
              <p>Your family assistant is ready. To send your first briefing email, we need permission to send emails on your behalf.</p>

              <div class="button-group" id="grant-send-group">
                <a href="/auth/google/grant-send" class="btn btn-primary" id="grant-send-btn">Allow sending emails</a>
              </div>

              <div class="button-group" id="send-email-group" style="display:none;">
                <button class="btn btn-primary" onclick="generateFirstEmail(this)" id="first-email-btn">Generate your first email</button>
              </div>

              <div id="first-email-result" style="display:none;margin-top:20px;"></div>

              <div class="feature-list" style="margin-top:30px;">
                <strong>Explore:</strong>
                <ul>
                  <li><a href="/todos">View your todo list</a></li>
                  <li><a href="/events">View your events</a></li>
                  <li><a href="/settings">Manage settings & senders</a></li>
                </ul>
              </div>

              <div class="button-group" style="margin-top:20px;">
                <button class="btn btn-secondary" onclick="window.location.href='/dashboard'">Go to Dashboard</button>
              </div>
            </div>
          </div>
        </div>

        <script>
          let allSenders = [];
          let senderPage = 0;
          const SENDERS_PER_PAGE = 5;
          let senderSelections = {}; // email -> 'include' | 'exclude'
          let analysisResult = null;
          let childrenData = [];

          function showStep(stepId) {
            document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
            document.getElementById(stepId).classList.add('active');
          }

          function showMessage(type, text) {
            const msg = document.getElementById('message');
            msg.className = 'message ' + type;
            msg.textContent = text;
            setTimeout(() => { msg.className = 'message'; }, 5000);
          }

          // --- Inbox scan ---
          async function scanInbox() {
            const btn = document.getElementById('scan-btn');
            btn.disabled = true;
            btn.textContent = 'Scanning...';

            try {
              const res = await fetch('/onboarding/scan-inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Scan failed');

              allSenders = data.senders;
              senderPage = 0;

              // Update step indicators
              document.getElementById('step-indicator-2').classList.add('active');

              renderSenderPage();
              showStep('step-senders');
            } catch (err) {
              showMessage('error', 'Scan failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Scan Inbox';
            }
          }

          function getCategoryBadge(category) {
            if (category === 'school') return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#d4edda;color:#155724;">School</span>';
            if (category === 'activity') return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#cce5ff;color:#004085;">Activity</span>';
            return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#e2e3e5;color:#383d41;">Other</span>';
          }

          function renderSenderCard(sender) {
            const isIncluded = senderSelections[sender.email] === 'include';
            const domain = sender.email.split('@')[1] || '';
            return \`
              <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:\${isIncluded ? '#f0f7f0' : '#fff'};border:2px solid \${isIncluded ? '#28a745' : '#e0e0e0'};border-radius:8px;margin-bottom:6px;transition:all 0.2s;">
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${sender.name}</span>
                    \${getCategoryBadge(sender.category || 'other')}
                  </div>
                  <div style="font-size:12px;color:#888;margin-top:2px;">\${domain} — \${sender.subjects.slice(0,2).join(' | ')}</div>
                </div>
                <button onclick="toggleSender('\${sender.email}')"
                  style="flex-shrink:0;margin-left:12px;padding:8px 20px;border-radius:6px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;\${isIncluded
                    ? 'background:#28a745;color:white;'
                    : 'background:#e0e0e0;color:#666;'}"
                >\${isIncluded ? 'Included' : 'Include'}</button>
              </div>
            \`;
          }

          function renderSenderPage() {
            const high = allSenders.filter(s => (s.relevance ?? 0) >= 0.7);
            const mid = allSenders.filter(s => (s.relevance ?? 0) >= 0.4 && (s.relevance ?? 0) < 0.7);
            const low = allSenders.filter(s => (s.relevance ?? 0) < 0.4);

            const container = document.getElementById('sender-list');
            let html = '';

            if (high.length > 0) {
              html += \`<div style="margin-bottom:20px;">
                <h3 style="font-size:15px;color:#155724;margin-bottom:10px;padding-left:4px;border-left:3px solid #28a745;padding-left:10px;">Likely school & family (\${high.length})</h3>
                \${high.map(s => renderSenderCard(s)).join('')}
              </div>\`;
            }

            if (mid.length > 0) {
              html += \`<div style="margin-bottom:20px;">
                <h3 style="font-size:15px;color:#856404;margin-bottom:10px;padding-left:4px;border-left:3px solid #ffc107;padding-left:10px;">Possibly relevant (\${mid.length})</h3>
                \${mid.map(s => renderSenderCard(s)).join('')}
              </div>\`;
            }

            if (low.length > 0) {
              html += \`<details style="margin-bottom:20px;">
                <summary style="font-size:15px;color:#666;margin-bottom:10px;cursor:pointer;padding-left:4px;border-left:3px solid #e0e0e0;padding-left:10px;">Other senders (\${low.length})</summary>
                <div style="margin-top:10px;">
                  \${low.map(s => renderSenderCard(s)).join('')}
                </div>
              </details>\`;
            }

            container.innerHTML = html;
            updateProgress();
          }

          function toggleSender(email) {
            if (senderSelections[email] === 'include') {
              delete senderSelections[email];
            } else {
              senderSelections[email] = 'include';
            }
            renderSenderPage();
          }

          function updateProgress() {
            const count = Object.values(senderSelections).filter(s => s === 'include').length;
            document.getElementById('progress-count').textContent = count + ' sender' + (count !== 1 ? 's' : '') + ' included';

            let hint = 'Select senders to monitor';
            let pct = 0;
            if (count >= 8) { hint = 'Excellent — your briefings will be comprehensive'; pct = 100; }
            else if (count >= 4) { hint = 'Great coverage'; pct = 75; }
            else if (count >= 1) { hint = 'Good start — keep going for better briefings'; pct = 40; }
            document.getElementById('progress-hint').textContent = hint;
            document.getElementById('progress-bar').style.width = pct + '%';
          }

          async function saveSenders() {
            // Require at least one include
            const includedCount = Object.values(senderSelections).filter(s => s === 'include').length;
            if (includedCount === 0) {
              showMessage('error', 'Please include at least one sender');
              return;
            }

            const btn = document.getElementById('save-senders-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              // Unselected senders are implicitly excluded
              const senders = allSenders.map(s => ({
                email: s.email,
                name: s.name,
                status: senderSelections[s.email] === 'include' ? 'include' : 'exclude',
              }));

              const res = await fetch('/onboarding/save-senders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senders }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Save failed');

              // Go to training step
              document.getElementById('step-indicator-3').classList.add('active');
              showStep('step-train');
              startTrainingExtraction();
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Confirm sender selection';
            }
          }

          // --- Training step ---
          let trainingItems = [];
          let trainingGrades = {}; // id -> true/false

          async function startTrainingExtraction() {
            document.getElementById('train-loading').style.display = 'block';
            document.getElementById('train-items').style.display = 'none';

            try {
              const res = await fetch('/onboarding/extract-for-training', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Extraction failed');

              trainingItems = data.items || [];
              document.getElementById('train-loading').style.display = 'none';
              document.getElementById('train-items').style.display = 'block';

              if (trainingItems.length === 0) {
                document.getElementById('train-items-list').style.display = 'none';
                document.getElementById('train-empty').style.display = 'block';
                document.getElementById('save-train-btn').disabled = false;
                document.getElementById('save-train-btn').textContent = 'Continue';
              } else {
                document.getElementById('train-items-list').style.display = 'block';
                document.getElementById('train-empty').style.display = 'none';
                renderTrainingItems();
              }
            } catch (err) {
              showMessage('error', 'Extraction failed: ' + err.message);
              document.getElementById('train-loading').style.display = 'none';
              document.getElementById('train-items').style.display = 'block';
              document.getElementById('train-empty').style.display = 'block';
              document.getElementById('save-train-btn').disabled = false;
            }
          }

          function renderTrainingItems() {
            const container = document.getElementById('train-items-list');
            container.innerHTML = trainingItems.map(item => {
              const graded = trainingGrades[item.id] !== undefined;
              const isRelevant = trainingGrades[item.id] === true;
              const isNotRelevant = trainingGrades[item.id] === false;
              const icon = item.item_type === 'todo' ? '✅' : '📅';
              return \`
                <div style="background:\${graded ? (isRelevant ? '#f0f7f0' : '#fff5f5') : '#fff'};border:2px solid \${graded ? (isRelevant ? '#28a745' : '#dc3545') : '#e0e0e0'};border-radius:8px;padding:16px;margin-bottom:8px;transition:all 0.2s;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="flex:1;min-width:0;">
                      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <span style="font-size:18px;">\${icon}</span>
                        <span style="font-weight:600;font-size:14px;">\${item.item_text}</span>
                      </div>
                      <div style="font-size:12px;color:#888;">From: \${item.source_sender || 'Unknown'}</div>
                      <div style="font-size:12px;color:#aaa;margin-top:2px;">\${item.source_subject || ''}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                      <button onclick="gradeItem(\${item.id}, true)" style="padding:6px 12px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;\${isRelevant ? 'background:#28a745;color:white;' : 'background:#e8f5e9;color:#28a745;'}">Relevant</button>
                      <button onclick="gradeItem(\${item.id}, false)" style="padding:6px 12px;border-radius:6px;border:none;font-size:12px;font-weight:600;cursor:pointer;\${isNotRelevant ? 'background:#dc3545;color:white;' : 'background:#ffebee;color:#dc3545;'}">Not Relevant</button>
                    </div>
                  </div>
                </div>
              \`;
            }).join('');
            updateTrainingProgress();
          }

          function gradeItem(id, isRelevant) {
            trainingGrades[id] = isRelevant;
            renderTrainingItems();
          }

          function updateTrainingProgress() {
            const graded = Object.keys(trainingGrades).length;
            const total = trainingItems.length;
            document.getElementById('train-progress').textContent = \`\${graded} of \${total} items graded\`;

            // Enable continue if at least half are graded or all are graded
            const minRequired = Math.min(5, Math.ceil(total / 2));
            document.getElementById('save-train-btn').disabled = graded < minRequired;
          }

          async function saveTrainingAndContinue() {
            const btn = document.getElementById('save-train-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const grades = Object.entries(trainingGrades).map(([id, isRelevant]) => ({
                id: parseInt(id),
                isRelevant,
              }));

              if (grades.length > 0) {
                const res = await fetch('/onboarding/save-feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ grades }),
                });
                if (!res.ok) {
                  const data = await res.json();
                  throw new Error(data.message || 'Save failed');
                }
              }

              // Continue to child extraction
              startChildExtraction();
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Continue';
            }
          }

          function skipTraining() {
            startChildExtraction();
          }

          // --- Child extraction ---
          async function startChildExtraction() {
            document.getElementById('step-indicator-4').classList.add('active');
            showStep('step-analyzing');

            try {
              const res = await fetch('/onboarding/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ aiProvider: 'openai' }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Analysis failed');

              analysisResult = data.result;
              childrenData = analysisResult.children.map(child => ({
                real_name: child.name,
                display_name: '',
                year_group: child.year_group || '',
                school_name: child.school_name || '',
                confidence: child.confidence,
                example_emails: child.example_emails || [],
                notes: '',
              }));

              document.getElementById('analysis-status').textContent =
                \`Found \${childrenData.length} child\${childrenData.length !== 1 ? 'ren' : ''}\`;
              document.getElementById('analysis-detail').textContent =
                \`Analyzed \${analysisResult.email_count_analyzed} emails\`;

              setTimeout(() => {
                renderChildCards();
                showStep('step-children');
              }, 1500);
            } catch (err) {
              showMessage('error', 'Analysis failed: ' + err.message);
              showStep('step-review-senders');
            }
          }

          // --- Child cards ---
          function renderChildCards() {
            const container = document.getElementById('child-cards-container');
            if (childrenData.length === 0) {
              container.innerHTML = \`
                <div class="empty-state">
                  <div class="empty-state-icon">🤷</div>
                  <h3>No children detected</h3>
                  <p>We couldn't find any child names. You can add children manually below.</p>
                </div>
              \`;
              return;
            }
            container.innerHTML = childrenData.map((child, i) => {
              const conf = child.confidence >= 0.8 ? 'confidence-high' : child.confidence >= 0.5 ? 'confidence-medium' : 'confidence-low';
              const confLabel = child.confidence >= 0.8 ? 'High' : child.confidence >= 0.5 ? 'Medium' : 'Low';
              return \`
                <div class="child-card \${child.confidence < 0.5 ? 'low-confidence' : ''}" data-index="\${i}">
                  <span class="confidence-badge \${conf}">\${confLabel} (\${Math.round(child.confidence * 100)}%)</span>
                  <div class="card-header"><div class="card-icon">👶</div><div class="card-title">\${child.real_name}</div></div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Real Name *</label>
                      <input type="text" value="\${child.real_name}" onchange="updateChild(\${i}, 'real_name', this.value)">
                    </div>
                    <div class="form-group">
                      <label>Display Name (optional)</label>
                      <input type="text" value="\${child.display_name}" onchange="updateChild(\${i}, 'display_name', this.value)" placeholder="e.g., Child A">
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Year Group</label>
                      <input type="text" value="\${child.year_group}" onchange="updateChild(\${i}, 'year_group', this.value)" placeholder="e.g., Year 3">
                    </div>
                    <div class="form-group">
                      <label>School Name</label>
                      <input type="text" value="\${child.school_name}" onchange="updateChild(\${i}, 'school_name', this.value)">
                    </div>
                  </div>
                  <details class="example-emails">
                    <summary>View example emails (\${child.example_emails.length})</summary>
                    <ul>\${child.example_emails.map(e => \`<li>\${e}</li>\`).join('')}</ul>
                  </details>
                  <button class="btn-remove-card" onclick="removeChild(\${i})">Remove</button>
                </div>
              \`;
            }).join('');
          }

          function updateChild(i, field, val) { childrenData[i][field] = val; }

          function removeChild(i) {
            if (confirm('Remove this child profile?')) {
              childrenData.splice(i, 1);
              renderChildCards();
            }
          }

          function addManualChild() {
            childrenData.push({
              real_name: 'New Child', display_name: '', year_group: '',
              school_name: analysisResult?.schools_detected[0] || '',
              confidence: 1.0, example_emails: [], notes: '',
            });
            renderChildCards();
          }

          async function confirmProfiles() {
            const invalid = childrenData.filter(c => !c.real_name || !c.real_name.trim());
            if (invalid.length > 0) { showMessage('error', 'Please provide a name for all children'); return; }

            const btn = document.getElementById('confirm-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const profiles = childrenData.map(c => ({
                real_name: c.real_name.trim(),
                display_name: c.display_name.trim() || undefined,
                year_group: c.year_group.trim() || undefined,
                school_name: c.school_name.trim() || undefined,
                notes: c.notes?.trim() || undefined,
              }));

              const res = await fetch('/onboarding/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profiles }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Save failed');

              showStep('step-complete');
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Confirm & Save';
            }
          }

          // --- First email ---
          async function generateFirstEmail(btn) {
            btn.disabled = true;
            btn.textContent = 'Generating & sending...';
            const result = document.getElementById('first-email-result');

            try {
              const res = await fetch('/onboarding/generate-first-email', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Failed to send');

              result.style.display = 'block';
              result.innerHTML = '<div class="message success">' + data.message + '</div>';
              btn.textContent = 'Email sent!';
            } catch (err) {
              result.style.display = 'block';
              result.innerHTML = '<div class="message error">Failed: ' + err.message + '</div>';
              btn.disabled = false;
              btn.textContent = 'Try again';
            }
          }

          // Check if send permission was just granted
          if (new URLSearchParams(window.location.search).get('send_granted') === '1') {
            const grantGroup = document.getElementById('grant-send-group');
            const sendGroup = document.getElementById('send-email-group');
            if (grantGroup) grantGroup.style.display = 'none';
            if (sendGroup) sendGroup.style.display = '';
            // Show the complete step
            showStep('step-complete');
          }

          // Auto-load review data if returning to step 3+
          (function() {
            const step = ${currentStep};
            if (step === 3) {
              // Load saved senders for review
              fetch('/onboarding/senders').then(r => r.json()).then(data => {
                if (data.filters) {
                  const included = data.filters.filter(f => f.status === 'include');
                  const excluded = data.filters.filter(f => f.status === 'exclude');
                  const container = document.getElementById('sender-review-list');
                  container.innerHTML = \`
                    <div style="margin-bottom:16px;">
                      <h3 style="color:#28a745;margin-bottom:8px;">Included (\${included.length})</h3>
                      \${included.map(s => \`<div style="padding:8px;background:#d4edda;border-radius:6px;margin-bottom:4px;font-size:14px;">\${s.sender_name || s.sender_email} — \${s.sender_email}</div>\`).join('')}
                    </div>
                  \`;
                }
              });
            }
          })();
        </script>
      </body>
      </html>
    `;

    return reply.type('text/html').send(html);
  });

  /**
   * GET /child-profiles-manage
   * Child profiles management page
   */
  fastify.get('/child-profiles-manage', { preHandler: requireAuth }, async (request, reply) => {
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const user = getUser(realUserId);

    if (!user) {
      fastify.log.warn({ userId: realUserId }, 'User not found in database');
      return reply.redirect('/login');
    }

    // Check for impersonation
    const impersonatingUserId = (request as any).impersonatingUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

    // Import content templates
    const { renderChildProfilesContent, renderChildProfilesScripts } = await import('../templates/childProfilesContent.js');

    // Generate content
    const content = renderChildProfilesContent();
    const scripts = renderChildProfilesScripts();

    // Render with layout
    const html = renderLayout({
      title: 'Child Profiles',
      currentPath: '/child-profiles-manage',
      user: {
        name: user.name,
        email: user.email,
        picture_url: user.picture_url,
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
}
