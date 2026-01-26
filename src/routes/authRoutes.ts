// src/routes/authRoutes.ts
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { storeAuth } from '../db/authDb.js';
import { upsertUser, getUser, ensureSuperAdminRoles } from '../db/userDb.js';
import { createSession, deleteSession } from '../db/sessionDb.js';
import { encrypt } from '../lib/crypto.js';
import { requireAuth } from '../middleware/session.js';
import type { AuthEntry } from '../types/todo.js';
import type { Role } from '../types/roles.js';
import { isAdmin, isSuperAdmin } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';

/**
 * Google OAuth scopes required for the application
 */
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
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
      const oauth2Client = createOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Critical for refresh token
        prompt: 'consent', // Force consent screen to get refresh token
        scope: OAUTH_SCOPES,
        state: state,
      });

      fastify.log.info('Redirecting to Google OAuth');
      return reply.redirect(authUrl);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error initiating OAuth flow');
      return reply.redirect('/auth/error?message=Failed to initiate login');
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

      // Exchange authorization code for tokens
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(query.code);

      // Verify we received a refresh token
      if (!tokens.refresh_token) {
        fastify.log.error('No refresh token received from Google');
        return reply.redirect('/auth/error?message=Configuration error - no refresh token');
      }

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

      fastify.log.info({ userId, email }, 'User authenticated successfully');

      // Encrypt tokens before storing
      const encryptedRefreshToken = encrypt(tokens.refresh_token);
      const refreshTokenData = `${encryptedRefreshToken.iv}:${encryptedRefreshToken.content}`;

      let accessTokenData: string | undefined;
      if (tokens.access_token) {
        const encryptedAccessToken = encrypt(tokens.access_token);
        accessTokenData = `${encryptedAccessToken.iv}:${encryptedAccessToken.content}`;
      }

      // Store encrypted tokens in auth table
      const authEntry: AuthEntry = {
        user_id: userId,
        refresh_token: refreshTokenData,
        access_token: accessTokenData,
        expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      };
      storeAuth(authEntry);

      // Upsert user profile
      upsertUser({
        user_id: userId,
        email: email,
        name: name,
        picture_url: pictureUrl,
      });

      // Ensure super admin gets all roles
      ensureSuperAdminRoles(email);

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

      // Redirect to dashboard
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
    const { getUser } = await import('../db/userDb.js');
    const realUser = getUser(realUserId);

    if (!realUser) {
      fastify.log.warn({ userId: realUserId }, 'User not found in database');
      return reply.redirect('/login');
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

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Child Profile Setup - Inbox Manager</title>
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
            <h1>👶 Child Profile Setup</h1>
            <a href="/dashboard" class="back-link">← Back to Dashboard</a>
          </div>

          <div id="message" class="message"></div>

          <!-- Steps indicator -->
          <div class="steps">
            <div class="step active" id="step-indicator-1">
              <div class="step-number">1</div>
              <div class="step-label">Welcome</div>
            </div>
            <div class="step" id="step-indicator-2">
              <div class="step-number">2</div>
              <div class="step-label">Analysis</div>
            </div>
            <div class="step" id="step-indicator-3">
              <div class="step-number">3</div>
              <div class="step-label">Review</div>
            </div>
            <div class="step" id="step-indicator-4">
              <div class="step-number">4</div>
              <div class="step-label">Complete</div>
            </div>
          </div>

          <!-- Step 1: Welcome -->
          <div class="step-content active" id="step-1">
            <div class="welcome-content">
              <div class="welcome-icon">👋</div>
              <h2>Welcome to Child Profile Setup</h2>
              <p>We'll analyze your recent school emails to automatically detect information about your children.</p>
              <p>This helps us personalize your daily summaries and organize information by child.</p>

              <div class="feature-list">
                <strong>What we'll extract:</strong>
                <ul>
                  <li>📛 Children's names mentioned in emails</li>
                  <li>🎓 Year groups (e.g., Year 3, Reception)</li>
                  <li>🏫 School names</li>
                </ul>
                <br>
                <strong>Privacy features:</strong>
                <ul>
                  <li>🔒 Add display name aliases (e.g., "Child A" instead of real name)</li>
                  <li>✏️ Review and edit all information before saving</li>
                  <li>🗑️ Remove any incorrect detections</li>
                </ul>
              </div>

              <p style="margin-top: 20px;"><small><em>We'll analyze approximately the last 90 days of emails. This takes 10-30 seconds.</em></small></p>

              <div class="button-group">
                <button class="btn btn-primary" onclick="startAnalysis()">Start Analysis</button>
              </div>
            </div>
          </div>

          <!-- Step 2: Analysis -->
          <div class="step-content" id="step-2">
            <div class="analysis-content">
              <div class="spinner"></div>
              <div class="analysis-status" id="analysis-status">Analyzing your emails...</div>
              <div class="analysis-detail" id="analysis-detail">This may take 10-30 seconds</div>
            </div>
          </div>

          <!-- Step 3: Review -->
          <div class="step-content" id="step-3">
            <div class="review-header">
              <h2>Review Detected Children</h2>
              <p>Please review the information below. You can edit names, add privacy aliases, and remove any incorrect detections.</p>
            </div>

            <div id="child-cards-container" class="child-cards">
              <!-- Cards will be inserted here -->
            </div>

            <button class="btn btn-add" onclick="addManualChild()">+ Add Child Manually</button>

            <div class="button-group">
              <button class="btn btn-secondary" onclick="goToStep(1)">Back</button>
              <button class="btn btn-primary" onclick="confirmProfiles()" id="confirm-btn">Confirm & Save</button>
            </div>
          </div>

          <!-- Step 4: Complete -->
          <div class="step-content" id="step-4">
            <div class="welcome-content">
              <div class="welcome-icon">✅</div>
              <h2>Setup Complete!</h2>
              <p>Your child profiles have been saved successfully.</p>
              <p>You can now view personalized summaries and manage profiles in Settings.</p>

              <div class="button-group">
                <button class="btn btn-secondary" onclick="window.location.href='/child-profiles-manage'">Manage Profiles</button>
                <button class="btn btn-primary" onclick="window.location.href='/dashboard'">Go to Dashboard</button>
              </div>
            </div>
          </div>
        </div>

        <script>
          let currentStep = 1;
          let analysisResult = null;
          let childrenData = [];

          function goToStep(step) {
            // Hide current step
            document.getElementById(\`step-\${currentStep}\`).classList.remove('active');
            document.getElementById(\`step-indicator-\${currentStep}\`).classList.remove('active');
            if (currentStep < step) {
              document.getElementById(\`step-indicator-\${currentStep}\`).classList.add('completed');
            }

            // Show new step
            currentStep = step;
            document.getElementById(\`step-\${currentStep}\`).classList.add('active');
            document.getElementById(\`step-indicator-\${currentStep}\`).classList.add('active');
          }

          async function startAnalysis() {
            goToStep(2);

            try {
              const response = await fetch('/onboarding/analyze', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ aiProvider: 'openai' })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.message || 'Failed to analyze emails');
              }

              analysisResult = data.result;
              childrenData = analysisResult.children.map(child => ({
                real_name: child.name,
                display_name: '',
                year_group: child.year_group || '',
                school_name: child.school_name || '',
                confidence: child.confidence,
                example_emails: child.example_emails || [],
                notes: ''
              }));

              document.getElementById('analysis-status').textContent = \`Found \${childrenData.length} child\${childrenData.length !== 1 ? 'ren' : ''}\`;
              document.getElementById('analysis-detail').textContent = \`Analyzed \${analysisResult.email_count_analyzed} emails\`;

              // Wait a moment to show the result, then proceed
              setTimeout(() => {
                renderChildCards();
                goToStep(3);
              }, 1500);

            } catch (error) {
              showMessage('error', 'Analysis failed: ' + error.message);
              setTimeout(() => goToStep(1), 2000);
            }
          }

          function renderChildCards() {
            const container = document.getElementById('child-cards-container');

            if (childrenData.length === 0) {
              container.innerHTML = \`
                <div class="empty-state">
                  <div class="empty-state-icon">🤷</div>
                  <h3>No children detected</h3>
                  <p>We couldn't find any child names in your recent emails.</p>
                  <p>You can add children manually using the button below.</p>
                </div>
              \`;
              return;
            }

            container.innerHTML = childrenData.map((child, index) => {
              const confidenceClass = child.confidence >= 0.8 ? 'confidence-high' :
                                      child.confidence >= 0.5 ? 'confidence-medium' : 'confidence-low';
              const confidenceLabel = child.confidence >= 0.8 ? 'High confidence' :
                                      child.confidence >= 0.5 ? 'Medium confidence' : 'Low confidence';
              const cardClass = child.confidence < 0.5 ? 'child-card low-confidence' : 'child-card';

              return \`
                <div class="\${cardClass}" data-index="\${index}">
                  <span class="confidence-badge \${confidenceClass}">\${confidenceLabel} (\${Math.round(child.confidence * 100)}%)</span>

                  <div class="card-header">
                    <div class="card-icon">👶</div>
                    <div class="card-title">\${child.real_name}</div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Real Name *</label>
                      <input type="text" value="\${child.real_name}"
                        onchange="updateChild(\${index}, 'real_name', this.value)"
                        placeholder="e.g., Ella">
                      <div class="help-text">Name as it appears in emails</div>
                    </div>
                    <div class="form-group">
                      <label>Display Name (Optional)</label>
                      <input type="text" value="\${child.display_name}"
                        onchange="updateChild(\${index}, 'display_name', this.value)"
                        placeholder="e.g., Child A">
                      <div class="help-text">Privacy alias for emails</div>
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Year Group</label>
                      <input type="text" value="\${child.year_group}"
                        onchange="updateChild(\${index}, 'year_group', this.value)"
                        placeholder="e.g., Year 3, Reception">
                    </div>
                    <div class="form-group">
                      <label>School Name</label>
                      <input type="text" value="\${child.school_name}"
                        onchange="updateChild(\${index}, 'school_name', this.value)"
                        placeholder="e.g., St Mary's Primary">
                    </div>
                  </div>

                  <div class="form-group">
                    <label>Notes (Optional)</label>
                    <input type="text" value="\${child.notes}"
                      onchange="updateChild(\${index}, 'notes', this.value)"
                      placeholder="e.g., Eldest child, loves sports">
                  </div>

                  <details class="example-emails">
                    <summary>📧 View example emails (\${child.example_emails.length})</summary>
                    <ul>
                      \${child.example_emails.map(email => \`<li>\${email}</li>\`).join('')}
                    </ul>
                  </details>

                  <button class="btn-remove-card" onclick="removeChild(\${index})">Remove This Child</button>
                </div>
              \`;
            }).join('');
          }

          function updateChild(index, field, value) {
            childrenData[index][field] = value;
          }

          function removeChild(index) {
            if (confirm('Are you sure you want to remove this child profile?')) {
              childrenData.splice(index, 1);
              renderChildCards();
            }
          }

          function addManualChild() {
            const newChild = {
              real_name: 'New Child',
              display_name: '',
              year_group: '',
              school_name: analysisResult?.schools_detected[0] || '',
              confidence: 1.0,
              example_emails: [],
              notes: ''
            };
            childrenData.push(newChild);
            renderChildCards();
          }

          async function confirmProfiles() {
            // Validate
            const invalidChildren = childrenData.filter(c => !c.real_name || c.real_name.trim() === '');
            if (invalidChildren.length > 0) {
              showMessage('error', 'Please provide a real name for all children');
              return;
            }

            const confirmBtn = document.getElementById('confirm-btn');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Saving...';

            try {
              // Prepare profiles for API
              const profiles = childrenData.map(child => ({
                real_name: child.real_name.trim(),
                display_name: child.display_name.trim() || undefined,
                year_group: child.year_group.trim() || undefined,
                school_name: child.school_name.trim() || undefined,
                notes: child.notes.trim() || undefined
              }));

              const response = await fetch('/onboarding/confirm', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ profiles })
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.message || 'Failed to save profiles');
              }

              goToStep(4);

            } catch (error) {
              showMessage('error', 'Save failed: ' + error.message);
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Confirm & Save';
            }
          }

          function showMessage(type, text) {
            const msg = document.getElementById('message');
            msg.className = 'message ' + type;
            msg.textContent = text;
            setTimeout(() => {
              msg.className = 'message';
            }, 5000);
          }
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
