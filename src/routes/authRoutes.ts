// src/routes/authRoutes.ts
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { storeAuth } from '../db/authDb.js';
import { upsertUser, getUser } from '../db/userDb.js';
import { createSession, deleteSession } from '../db/sessionDb.js';
import { encrypt } from '../lib/crypto.js';
import { requireAuth } from '../middleware/session.js';
import type { AuthEntry } from '../types/todo.js';

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
   * GET /
   * Redirect root to login page
   */
  fastify.get('/', async (_request, reply) => {
    return reply.redirect('/login');
  });

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
    const userId = (request as any).userId;

    if (!userId) {
      return reply.redirect('/login');
    }

    // Get user profile
    const { getUser } = await import('../db/userDb.js');
    const user = getUser(userId);

    if (!user) {
      fastify.log.warn({ userId }, 'User not found in database');
      return reply.redirect('/login');
    }

    // Get upcoming events (next 5)
    const { getUpcomingEvents } = await import('../db/eventDb.js');
    const upcomingEvents = getUpcomingEvents(userId, 7).slice(0, 5);

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard - Inbox Manager</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: #f5f5f5;
          }
          .header {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .user-info {
            display: flex;
            align-items: center;
            gap: 1rem;
          }
          .avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
          }
          .user-details {
            display: flex;
            flex-direction: column;
          }
          .user-name {
            font-weight: 600;
            font-size: 1.1rem;
            color: #333;
          }
          .user-email {
            font-size: 14px;
            color: #666;
          }
          .btn-logout {
            background: #dc3545;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s;
          }
          .btn-logout:hover {
            background: #c82333;
          }
          .content {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          h1 {
            margin-top: 0;
            color: #333;
          }
          .api-section {
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid #e0e0e0;
          }
          .api-link {
            display: inline-block;
            margin: 0.5rem 1rem 0.5rem 0;
            padding: 10px 16px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-size: 14px;
            transition: background 0.2s;
          }
          .api-link:hover {
            background: #0056b3;
          }
          .success-message {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 1rem;
            border-radius: 6px;
            margin-bottom: 1.5rem;
          }
          .error-message {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 1rem;
            border-radius: 6px;
            margin-bottom: 1.5rem;
          }
          .btn-test {
            display: inline-block;
            margin: 0.5rem 1rem 0.5rem 0;
            padding: 10px 16px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .btn-test:hover {
            background: #218838;
          }
          .btn-test:disabled {
            background: #6c757d;
            cursor: not-allowed;
          }
          #test-result {
            margin-top: 1rem;
            display: none;
          }
          .onboarding-banner {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem;
            border-radius: 8px;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            display: none;
          }
          .onboarding-banner h3 {
            margin: 0 0 0.5rem 0;
            font-size: 1.2rem;
          }
          .onboarding-banner p {
            margin: 0 0 1rem 0;
            opacity: 0.95;
          }
          .btn-onboarding {
            background: white;
            color: #667eea;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 15px;
            font-weight: 600;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-block;
          }
          .btn-onboarding:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }
          .event-card {
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 10px;
            transition: all 0.2s;
          }
          .event-card:hover {
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border-color: #ccc;
          }
          .event-title {
            font-weight: 600;
            color: #333;
            margin-bottom: 4px;
          }
          .event-date {
            font-size: 13px;
            color: #666;
            margin-bottom: 4px;
          }
          .event-meta {
            font-size: 12px;
            color: #888;
          }
          .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            margin-left: 8px;
          }
          .status-synced {
            background: #d4edda;
            color: #155724;
          }
          .status-pending {
            background: #fff3cd;
            color: #856404;
          }
          .status-failed {
            background: #f8d7da;
            color: #721c24;
          }
          .no-events {
            color: #666;
            font-style: italic;
            text-align: center;
            padding: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="user-info">
            <img src="${user.picture_url || 'https://via.placeholder.com/48'}"
                 alt="${user.name || 'User'}"
                 class="avatar">
            <div class="user-details">
              <div class="user-name">${user.name || 'User'}</div>
              <div class="user-email">${user.email}</div>
            </div>
          </div>
          <form action="/logout" method="POST">
            <button type="submit" class="btn-logout">Logout</button>
          </form>
        </div>

        <div class="content">
          <div class="success-message">
            ✅ Successfully authenticated! Your account is connected to Google Calendar, Gmail, and Drive.
          </div>

          <div class="onboarding-banner" id="onboarding-banner">
            <h3>👋 Set Up Child Profiles</h3>
            <p>Help us personalize your experience! We can analyze your school emails to automatically extract information about your children (names, year groups, schools). You'll be able to review and edit everything before saving.</p>
            <a href="/child-profiles-manage" class="btn-onboarding">Get Started</a>
          </div>

          <h1>Welcome to Inbox Manager</h1>
          <p>Your personal productivity hub is ready to use.</p>

          <div class="api-section">
            <h2>Available Features</h2>
            <p>Explore the API endpoints to manage your data:</p>
            <a href="/emails-view" class="api-link">📧 Stored Emails</a>
            <a href="/todos-view" class="api-link">📝 View TODOs</a>
            <a href="/events-view" class="api-link">📅 View Events</a>
            <a href="/child-profiles-manage" class="api-link">👶 Child Profiles</a>
            <a href="/analyses-view" class="api-link">🔍 Email Analyses</a>
            <a href="/metrics/dashboard" class="api-link">📊 AI Metrics Dashboard</a>
            <a href="/metrics" class="api-link">📈 Prometheus Metrics</a>
            <a href="/health" class="api-link">💚 Health Check</a>
            <a href="/settings" class="api-link">⚙️ Settings</a>
          </div>

          <div class="api-section">
            <h2>📅 Upcoming Events</h2>
            ${
              upcomingEvents.length > 0
                ? upcomingEvents
                    .map(
                      (event) => `
                <div class="event-card">
                  <div class="event-title">
                    ${event.title}
                    <span class="status-badge status-${event.sync_status}">${
                        event.sync_status === 'synced'
                          ? '✓ Synced'
                          : event.sync_status === 'pending'
                          ? '⏳ Pending'
                          : '⚠ Failed'
                      }</span>
                  </div>
                  <div class="event-date">
                    📆 ${new Date(event.date).toLocaleDateString('en-GB', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  ${event.child_name ? `<div class="event-meta">👶 ${event.child_name}</div>` : ''}
                  ${event.location ? `<div class="event-meta">📍 ${event.location}</div>` : ''}
                </div>
              `
                    )
                    .join('')
                : '<div class="no-events">No upcoming events in the next 7 days</div>'
            }
            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
              <a href="/events-view" style="color: #007bff; text-decoration: none;">View all events →</a>
              <button class="btn-test" id="sync-events-btn" onclick="syncEvents()" style="margin-left: auto;">
                🔄 Sync to Google Calendar
              </button>
            </div>
            <div id="sync-events-result" style="margin-top: 0.5rem; display: none;"></div>
          </div>

          <div class="api-section">
            <h2>🧹 Cleanup Past Items</h2>
            <p>Auto-complete past todos and remove past events (items due before today):</p>
            <button class="btn-test" id="cleanup-btn" onclick="runCleanup()">
              🧹 Run Cleanup
            </button>
            <div id="cleanup-result"></div>
          </div>

          <div class="api-section">
            <h2>✨ Personalized Family Briefing (New!)</h2>
            <p>Preview or send the personalized summary that uses stored events and todos:</p>
            <button class="btn-test" id="personalized-preview-btn" onclick="previewPersonalizedSummary()">
              👁️ Preview Summary
            </button>
            <button class="btn-test" id="send-daily-summary-btn" onclick="sendDailySummary()" style="background: #28a745;">
              📧 Send Daily Summary
            </button>
            <div id="personalized-result" style="margin-top: 1rem; display: none;"></div>
            <p style="margin-top: 0.5rem; font-size: 13px; color: #666;">
              💡 This uses Phase 4 pipeline: stored events & todos + AI insights. Summary is sent to recipients configured in Settings.
            </p>
          </div>

          <div class="api-section">
            <h2>📧 Email Storage</h2>
            <p>Emails are now stored in the database for faster access and offline viewing.</p>
            <a href="/emails-view" class="api-link" style="display: inline-block; margin-top: 0.5rem;">📧 View Stored Emails</a>
            <a href="/admin/trigger-email-fetch" class="api-link" style="display: inline-block; margin-top: 0.5rem; background: #28a745;">🔄 Trigger Email Fetch</a>
            <p style="margin-top: 1rem; font-size: 13px; color: #666;">
              💡 Emails are automatically fetched daily at 6:00 AM UTC. Use "Trigger Email Fetch" for manual sync.
            </p>
          </div>

          <div class="api-section">
            <h2>📬 Daily Email Summary (Legacy)</h2>
            <p>Test the original AI-powered daily email summary feature:</p>
            <div style="margin-bottom: 1rem; display: flex; gap: 1rem; flex-wrap: wrap;">
              <label style="font-size: 14px; color: #666;">
                AI Provider:
                <select id="ai-provider-select" style="margin-left: 0.5rem; padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc;">
                  <option value="openai" selected>OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </label>
              <label style="font-size: 14px; color: #666;">
                Date Range:
                <select id="date-range-select" style="margin-left: 0.5rem; padding: 4px 8px; border-radius: 4px; border: 1px solid #ccc;">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last3days">Last 3 Days</option>
                  <option value="last7days" selected>Last 7 Days</option>
                  <option value="last30days">Last Month</option>
                  <option value="last90days">Last 3 Months</option>
                </select>
              </label>
            </div>
            <button class="btn-test" id="send-test-btn" onclick="sendTestSummary()">
              📧 Send Summary (uses Settings recipients)
            </button>
            <button class="btn-test" id="preview-btn" onclick="previewSummary()">
              👁️ Preview HTML
            </button>
            <button class="btn-test" id="view-emails-btn" onclick="viewRawEmails()">
              📨 View Raw Emails
            </button>
            <div id="test-result"></div>
            <p style="margin-top: 1rem; font-size: 13px; color: #666;">
              <strong>Troubleshooting:</strong>
              <button class="btn-test" onclick="checkScopes()" style="margin-left: 0.5rem; padding: 6px 12px; font-size: 12px;">
                🔍 Check Permissions
              </button>
              <button class="btn-test" onclick="testGmailSend()" style="margin-left: 0.5rem; padding: 6px 12px; font-size: 12px;">
                🧪 Test Gmail API
              </button>
            </p>
            <div id="scope-result" style="margin-top: 1rem; display: none;"></div>
          </div>

          <div class="api-section" style="border: 2px solid #dc3545; background: #fff5f5;">
            <h2>🧪 Testing Tools</h2>
            <p style="color: #721c24;">Reset all your data for testing purposes. This cannot be undone.</p>
            <button class="btn-test" id="reset-data-btn" onclick="resetAllData()" style="background: #dc3545; color: white;">
              🗑️ Reset All My Data
            </button>
            <div id="reset-result" style="margin-top: 0.5rem; display: none;"></div>
            <p style="margin-top: 0.5rem; font-size: 13px; color: #666;">
              This will delete: stored emails, email analyses, events, and todos.
            </p>
          </div>
        </div>

        <script>
          async function testGmailSend() {
            const resultDiv = document.getElementById('scope-result');
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>⏳ Testing Gmail send capability...</strong>';

            try {
              const response = await fetch('/admin/test-gmail-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              });
              const data = await response.json();

              if (data.success) {
                resultDiv.className = 'success-message';
                resultDiv.innerHTML = \`
                  <strong>✅ Gmail send works!</strong><br>
                  Successfully sent a test email to \${data.recipient}<br>
                  Check your inbox to confirm.
                \`;
              } else if (data.issue === 'missing_scope') {
                resultDiv.className = 'error-message';
                resultDiv.innerHTML = \`
                  <strong>❌ Missing gmail.send scope</strong><br>
                  Your token doesn't have the required permission.<br>
                  <br>
                  <strong>To fix:</strong><br>
                  1. <a href="https://myaccount.google.com/permissions" target="_blank" style="color: #721c24;">Remove app access</a><br>
                  2. <a href="/auth/google" style="color: #721c24;">Sign in again</a>
                \`;
              } else if (data.issue === 'api_error') {
                resultDiv.className = 'error-message';
                resultDiv.innerHTML = \`
                  <strong>❌ Gmail API Error</strong><br>
                  Error code: \${data.errorCode}<br>
                  Message: \${data.errorMessage}<br>
                  <br>
                  <strong>Possible causes:</strong><br>
                  \${data.possibleCauses.map(c => '• ' + c).join('<br>')}<br>
                  <br>
                  <strong>If error 403:</strong> Check that Gmail API is enabled in your
                  <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" style="color: #721c24;">
                    Google Cloud Console
                  </a>
                \`;
              } else {
                throw new Error(data.message || 'Unknown error');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`
                <strong>❌ Error:</strong> \${error.message}
              \`;
            }
          }

          async function checkScopes() {
            const resultDiv = document.getElementById('scope-result');
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>⏳ Checking permissions...</strong>';

            try {
              const response = await fetch('/admin/check-scopes');
              const data = await response.json();

              if (response.ok) {
                const hasSend = data.hasGmailSend;
                const hasRead = data.hasGmailReadonly;

                if (hasSend && hasRead) {
                  resultDiv.className = 'success-message';
                  resultDiv.innerHTML = \`
                    <strong>✅ All permissions granted!</strong><br>
                    You have both Gmail read and send permissions.<br>
                    <small>Scopes: \${data.scopes?.join(', ')}</small>
                  \`;
                } else {
                  resultDiv.className = 'error-message';
                  resultDiv.innerHTML = \`
                    <strong>❌ Missing permissions!</strong><br>
                    Gmail Send: \${hasSend ? '✅' : '❌'}<br>
                    Gmail Read: \${hasRead ? '✅' : '❌'}<br>
                    <br>
                    <strong>To fix this:</strong><br>
                    1. Visit <a href="https://myaccount.google.com/permissions" target="_blank" style="color: #721c24;">Google Account Permissions</a><br>
                    2. Find "Inbox Manager" and click "Remove Access"<br>
                    3. Come back and <a href="/auth/google" style="color: #721c24;">sign in again</a><br>
                    <br>
                    <small>Current scopes: \${data.scopes?.join(', ')}</small>
                  \`;
                }
              } else {
                throw new Error(data.message || 'Failed to check scopes');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`
                <strong>❌ Error:</strong> \${error.message}
              \`;
            }
          }

          async function sendTestSummary() {
            const btn = document.getElementById('send-test-btn');
            const resultDiv = document.getElementById('test-result');
            const providerSelect = document.getElementById('ai-provider-select');
            const dateRangeSelect = document.getElementById('date-range-select');

            btn.disabled = true;
            btn.textContent = '⏳ Generating and sending...';
            resultDiv.style.display = 'none';

            try {
              const response = await fetch('/admin/send-daily-summary', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  dateRange: dateRangeSelect.value,
                  maxResults: 100,
                  aiProvider: providerSelect.value
                  // No testRecipients - use settings
                })
              });

              const data = await response.json();

              if (response.ok) {
                resultDiv.className = 'success-message';
                resultDiv.innerHTML = \`
                  <strong>✅ Email sent successfully!</strong><br>
                  Sent to \${data.recipients.length} recipient(s): \${data.recipients.join(', ')}<br>
                  Child summaries: \${data.summary.childSummaries}<br>
                  Kit needed tomorrow: \${data.summary.kitTomorrow}<br>
                  Upcoming kit items: \${data.summary.kitUpcoming}<br>
                  Financials: \${data.summary.financials}<br>
                  Calendar updates: \${data.summary.calendarUpdates}
                \`;
              } else {
                throw new Error(data.message || 'Failed to send email');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`
                <strong>❌ Error:</strong> \${error.message}
              \`;
            } finally {
              resultDiv.style.display = 'block';
              btn.disabled = false;
              btn.textContent = '📧 Send Summary (uses Settings recipients)';
            }
          }

          async function previewSummary() {
            const btn = document.getElementById('preview-btn');
            const resultDiv = document.getElementById('test-result');
            const providerSelect = document.getElementById('ai-provider-select');
            const dateRangeSelect = document.getElementById('date-range-select');

            btn.disabled = true;
            btn.textContent = '⏳ Generating preview...';
            resultDiv.style.display = 'none';

            try {
              const response = await fetch('/admin/preview-email-summary', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  dateRange: dateRangeSelect.value,
                  maxResults: 100,
                  aiProvider: providerSelect.value
                })
              });

              if (response.ok) {
                // Open preview in new tab
                const html = await response.text();
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');

                resultDiv.className = 'success-message';
                resultDiv.innerHTML = '<strong>✅ Preview opened in new tab!</strong>';
                resultDiv.style.display = 'block';
              } else {
                const text = await response.text();
                throw new Error('Failed to generate preview');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`
                <strong>❌ Error:</strong> \${error.message}
              \`;
              resultDiv.style.display = 'block';
            } finally {
              btn.disabled = false;
              btn.textContent = '👁️ Preview HTML';
            }
          }

          async function viewRawEmails() {
            const btn = document.getElementById('view-emails-btn');
            const resultDiv = document.getElementById('test-result');
            const dateRangeSelect = document.getElementById('date-range-select');

            btn.disabled = true;
            btn.textContent = '⏳ Fetching emails...';
            resultDiv.style.display = 'none';

            try {
              const response = await fetch('/admin/view-raw-emails', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  dateRange: dateRangeSelect.value,
                  maxResults: 100
                })
              });

              if (response.ok) {
                // Open raw emails in new tab
                const text = await response.text();
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');

                resultDiv.className = 'success-message';
                resultDiv.innerHTML = '<strong>✅ Raw emails opened in new tab!</strong>';
                resultDiv.style.display = 'block';
              } else {
                throw new Error('Failed to fetch emails');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`
                <strong>❌ Error:</strong> \${error.message}
              \`;
              resultDiv.style.display = 'block';
            } finally {
              btn.disabled = false;
              btn.textContent = '📨 View Raw Emails';
            }
          }

          async function fetchRawEmails() {
            const btn = document.getElementById('raw-email-btn');
            const resultDiv = document.getElementById('raw-email-result');
            const dateRange = document.getElementById('raw-email-range').value;
            const maxResults = parseInt(document.getElementById('raw-email-max').value);

            btn.disabled = true;
            btn.textContent = '⏳ Fetching emails...';
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">📥 Fetching emails...</div>';

            try {
              const response = await fetch('/admin/raw-emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateRange, maxResults })
              });

              const data = await response.json();

              if (response.ok) {
                if (data.emails && data.emails.length > 0) {
                  const emailsHtml = data.emails.map((email, index) => {
                    let html = '<div style="background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1rem; margin-bottom: 1rem;">';
                    html += '<div style="font-weight: 600; color: #333; margin-bottom: 0.5rem;">';
                    html += (index + 1) + '. ' + (email.subject || '(No subject)');
                    html += '</div>';
                    html += '<div style="font-size: 13px; color: #666; margin-bottom: 0.5rem;">';
                    html += 'From: ' + (email.from || 'Unknown') + '<br>';
                    html += 'Date: ' + new Date(email.date).toLocaleString() + '<br>';
                    html += 'ID: ' + email.id;
                    html += '</div>';
                    if (email.labels && email.labels.length > 0) {
                      html += '<div style="font-size: 12px; margin-bottom: 0.5rem;">';
                      html += email.labels.map(label => '<span style="background: #e3f2fd; padding: 2px 6px; border-radius: 3px; margin-right: 4px;">' + label + '</span>').join('');
                      html += '</div>';
                    }
                    if (email.bodyText) {
                      html += '<div style="font-size: 13px; color: #555; padding: 0.75rem; background: #f8f9fa; border-radius: 4px; margin-top: 0.5rem; white-space: pre-wrap; max-height: 400px; overflow-y: auto; border: 1px solid #dee2e6;">';
                      html += email.bodyText;
                      html += '</div>';
                    }
                    html += '</div>';
                    return html;
                  }).join('');

                  resultDiv.innerHTML = '<div style="background: #d4edda; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; color: #155724;"><strong>✅ Fetched ' + data.emails.length + ' emails</strong></div>' + emailsHtml;
                } else {
                  resultDiv.innerHTML = '<div style="background: #fff3cd; padding: 1rem; border-radius: 6px; color: #856404;">ℹ️ No emails found in this date range</div>';
                }
              } else {
                throw new Error(data.error || 'Failed to fetch emails');
              }
            } catch (error) {
              resultDiv.innerHTML = '<div style="background: #f8d7da; padding: 1rem; border-radius: 6px; color: #721c24;"><strong>❌ Error:</strong> ' + error.message + '</div>';
            } finally {
              btn.disabled = false;
              btn.textContent = '📨 Fetch Raw Emails';
            }
          }

          async function runCleanup() {
            const btn = document.getElementById('cleanup-btn');
            const resultDiv = document.getElementById('cleanup-result');

            btn.disabled = true;
            btn.textContent = '⏳ Running cleanup...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>🧹 Cleaning up past items...</strong>';

            try {
              const response = await fetch('/admin/cleanup', {
                method: 'POST'
              });

              const data = await response.json();

              if (response.ok && data.success) {
                resultDiv.className = 'success-message';
                const cutoffDate = new Date(data.cleanup.cutoff_date).toLocaleDateString();
                resultDiv.innerHTML = \`
                  <strong>✅ Cleanup complete!</strong><br>
                  ✓ Todos auto-completed: \${data.cleanup.todos_auto_completed}<br>
                  ✓ Events removed: \${data.cleanup.events_removed}<br>
                  📅 Cutoff date: \${cutoffDate}<br>
                  <br>
                  <a href="/todos-view" style="color: #667eea; text-decoration: underline;">View Todos →</a>
                \`;
              } else {
                throw new Error(data.message || 'Cleanup failed');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`<strong>❌ Error:</strong> \${error.message}\`;
            } finally {
              btn.disabled = false;
              btn.textContent = '🧹 Run Cleanup';
            }
          }

          async function previewPersonalizedSummary() {
            const btn = document.getElementById('personalized-preview-btn');
            const resultDiv = document.getElementById('personalized-result');

            btn.disabled = true;
            btn.textContent = '⏳ Generating preview...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>✨ Generating personalized summary...</strong>';

            try {
              const response = await fetch('/admin/preview-personalized-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              });

              if (response.ok) {
                // Open in new tab
                const html = await response.text();
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');

                resultDiv.className = 'success-message';
                resultDiv.innerHTML = '<strong>✅ Preview opened in new tab!</strong>';
              } else {
                throw new Error('Failed to generate preview');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`<strong>❌ Error:</strong> \${error.message}\`;
            } finally {
              btn.disabled = false;
              btn.textContent = '👁️ Preview Summary';
            }
          }

          async function sendDailySummary() {
            const btn = document.getElementById('send-daily-summary-btn');
            const resultDiv = document.getElementById('personalized-result');

            btn.disabled = true;
            btn.textContent = '⏳ Sending...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>📧 Sending daily summary...</strong>';

            try {
              const response = await fetch('/admin/trigger-daily-summary');
              const data = await response.json();

              if (response.ok && data.success) {
                resultDiv.className = 'success-message';
                resultDiv.innerHTML = '<strong>✅ Daily summary triggered!</strong><br>Check the configured email recipients.';
              } else {
                throw new Error(data.error || 'Failed to send summary');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`<strong>❌ Error:</strong> \${error.message}\`;
            } finally {
              btn.disabled = false;
              btn.textContent = '📧 Send Daily Summary';
            }
          }

          async function syncEvents() {
            const btn = document.getElementById('sync-events-btn');
            const resultDiv = document.getElementById('sync-events-result');

            btn.disabled = true;
            btn.textContent = '⏳ Syncing...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>🔄 Syncing events to Google Calendar...</strong>';

            try {
              const response = await fetch('/admin/trigger-event-sync');
              const data = await response.json();

              if (response.ok && data.success) {
                resultDiv.className = 'success-message';
                resultDiv.innerHTML = '<strong>✅ Event sync triggered!</strong><br>Pending events will be synced to Google Calendar.';
                // Reload after a delay to show updated sync status
                setTimeout(() => window.location.reload(), 2000);
              } else {
                throw new Error(data.error || 'Failed to sync events');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`<strong>❌ Error:</strong> \${error.message}\`;
            } finally {
              btn.disabled = false;
              btn.textContent = '🔄 Sync to Google Calendar';
            }
          }

          async function resetAllData() {
            if (!confirm('⚠️ This will delete ALL your data:\\n\\n• All stored emails\\n• All email analyses\\n• All events\\n• All todos\\n\\nThis cannot be undone. Are you sure?')) {
              return;
            }

            const btn = document.getElementById('reset-data-btn');
            const resultDiv = document.getElementById('reset-result');
            btn.disabled = true;
            btn.textContent = '⏳ Resetting...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success-message';
            resultDiv.innerHTML = '<strong>⏳ Resetting all data...</strong>';

            try {
              const response = await fetch('/api/reset-all-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              const data = await response.json();

              if (response.ok) {
                resultDiv.className = 'success-message';
                resultDiv.innerHTML = \`<strong>✅ All data reset!</strong><br>
                  Deleted: \${data.deleted.emails} emails, \${data.deleted.analyses} analyses,
                  \${data.deleted.events} events, \${data.deleted.todos} todos\`;
                setTimeout(() => window.location.reload(), 2000);
              } else {
                throw new Error(data.error || 'Failed to reset data');
              }
            } catch (error) {
              resultDiv.className = 'error-message';
              resultDiv.innerHTML = \`<strong>❌ Error:</strong> \${error.message}\`;
            } finally {
              btn.disabled = false;
              btn.textContent = '🗑️ Reset All My Data';
            }
          }

          // Check onboarding status on page load
          async function checkOnboardingStatus() {
            try {
              const response = await fetch('/onboarding/status');
              if (response.ok) {
                const data = await response.json();

                // Show banner if onboarding not completed
                if (!data.onboarding_completed) {
                  document.getElementById('onboarding-banner').style.display = 'block';
                }
              }
            } catch (error) {
              console.error('Failed to check onboarding status:', error);
            }
          }

          // Run status check when page loads
          checkOnboardingStatus();
        </script>
      </body>
      </html>
    `;

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
    const userId = (request as any).userId;
    const user = getUser(userId);

    if (!user) {
      fastify.log.warn({ userId }, 'User not found in database');
      return reply.redirect('/login');
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Manage Child Profiles - Inbox Manager</title>
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem 1rem;
          }

          .container {
            max-width: 1000px;
            margin: 0 auto;
          }

          .header {
            background: white;
            padding: 1.5rem 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          }

          .header-left {
            display: flex;
            align-items: center;
            gap: 1rem;
          }

          .back-btn {
            background: #f0f0f0;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            color: #333;
            text-decoration: none;
            display: inline-block;
            transition: background 0.2s;
          }

          .back-btn:hover {
            background: #e0e0e0;
          }

          h1 {
            font-size: 1.8rem;
            color: #333;
          }

          .toolbar {
            background: white;
            padding: 1.5rem 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            align-items: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          }

          .btn {
            padding: 10px 20px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 15px;
            font-weight: 500;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-block;
          }

          .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }

          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
          }

          .btn-secondary {
            background: #28a745;
            color: white;
          }

          .btn-secondary:hover {
            background: #218838;
          }

          .filter-group {
            display: flex;
            gap: 0.5rem;
            align-items: center;
            margin-left: auto;
          }

          .filter-btn {
            padding: 8px 16px;
            border: 2px solid #667eea;
            background: white;
            color: #667eea;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          }

          .filter-btn.active {
            background: #667eea;
            color: white;
          }

          .profiles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
          }

          .profile-card {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s;
            position: relative;
          }

          .profile-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
          }

          .profile-card.inactive {
            opacity: 0.6;
          }

          .profile-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
          }

          .profile-name {
            font-size: 1.3rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 0.25rem;
          }

          .profile-alias {
            font-size: 0.9rem;
            color: #666;
            font-style: italic;
          }

          .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
          }

          .status-active {
            background: #d4edda;
            color: #155724;
          }

          .status-inactive {
            background: #f8d7da;
            color: #721c24;
          }

          .profile-details {
            margin: 1rem 0;
          }

          .profile-detail {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
            font-size: 14px;
            color: #555;
          }

          .profile-detail-icon {
            font-size: 16px;
          }

          .profile-notes {
            background: #f8f9fa;
            padding: 0.75rem;
            border-radius: 6px;
            font-size: 13px;
            color: #666;
            margin-top: 1rem;
            font-style: italic;
          }

          .profile-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #e0e0e0;
          }

          .btn-small {
            flex: 1;
            padding: 8px 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
          }

          .btn-edit {
            background: #007bff;
            color: white;
          }

          .btn-edit:hover {
            background: #0056b3;
          }

          .btn-delete {
            background: #dc3545;
            color: white;
          }

          .btn-delete:hover {
            background: #c82333;
          }

          .empty-state {
            background: white;
            padding: 3rem 2rem;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          }

          .empty-state-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
          }

          .empty-state h2 {
            font-size: 1.5rem;
            color: #333;
            margin-bottom: 0.5rem;
          }

          .empty-state p {
            color: #666;
            margin-bottom: 1.5rem;
          }

          /* Modal styles */
          .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            z-index: 1000;
            align-items: center;
            justify-content: center;
          }

          .modal.active {
            display: flex;
          }

          .modal-content {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
          }

          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
          }

          .modal-header h2 {
            font-size: 1.5rem;
            color: #333;
          }

          .close-btn {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #999;
          }

          .close-btn:hover {
            color: #333;
          }

          .form-group {
            margin-bottom: 1.5rem;
          }

          .form-group label {
            display: block;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: #333;
          }

          .form-group input,
          .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.2s;
          }

          .form-group input:focus,
          .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
          }

          .form-group textarea {
            resize: vertical;
            min-height: 80px;
          }

          .form-group small {
            display: block;
            margin-top: 0.25rem;
            color: #666;
            font-size: 12px;
          }

          .checkbox-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .checkbox-group input[type="checkbox"] {
            width: auto;
          }

          .modal-actions {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
          }

          .message {
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1.5rem;
            font-size: 14px;
            display: none;
          }

          .message.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            display: block;
          }

          .message.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            display: block;
          }

          .loading {
            text-align: center;
            padding: 2rem;
            color: white;
            font-size: 1.1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-left">
              <a href="/dashboard" class="back-btn">← Back to Dashboard</a>
              <h1>👶 Child Profiles</h1>
            </div>
          </div>

          <div id="message" class="message"></div>

          <div class="toolbar">
            <button class="btn btn-secondary" onclick="addChildManually()">
              ➕ Add Child Manually
            </button>
            <a href="/onboarding" class="btn btn-primary">
              🔍 Run Analysis Again
            </a>
            <div class="filter-group">
              <span style="font-size: 14px; color: #666;">Show:</span>
              <button class="filter-btn active" onclick="filterProfiles('all')">All</button>
              <button class="filter-btn" onclick="filterProfiles('active')">Active</button>
              <button class="filter-btn" onclick="filterProfiles('inactive')">Inactive</button>
            </div>
          </div>

          <div id="loading" class="loading" style="display: none;">
            Loading profiles...
          </div>

          <div id="profiles-container"></div>
        </div>

        <!-- Edit Modal -->
        <div id="edit-modal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <h2 id="modal-title">Edit Child Profile</h2>
              <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>

            <form id="edit-form" onsubmit="saveProfile(event)">
              <input type="hidden" id="edit-profile-id">

              <div class="form-group">
                <label for="edit-real-name">Real Name *</label>
                <input type="text" id="edit-real-name" required>
                <small>Actual name from school emails</small>
              </div>

              <div class="form-group">
                <label for="edit-display-name">Display Name (Privacy Alias)</label>
                <input type="text" id="edit-display-name">
                <small>Optional: Use an alias like "Child A" for privacy in sent emails</small>
              </div>

              <div class="form-group">
                <label for="edit-year-group">Year Group</label>
                <input type="text" id="edit-year-group" placeholder="e.g., Year 3, Reception">
              </div>

              <div class="form-group">
                <label for="edit-school-name">School Name</label>
                <input type="text" id="edit-school-name" placeholder="e.g., St Mary's Primary">
              </div>

              <div class="form-group">
                <label for="edit-notes">Notes</label>
                <textarea id="edit-notes" placeholder="Any additional notes..."></textarea>
              </div>

              <div class="form-group">
                <div class="checkbox-group">
                  <input type="checkbox" id="edit-is-active" checked>
                  <label for="edit-is-active" style="margin-bottom: 0;">Active enrollment</label>
                </div>
                <small>Uncheck if child has graduated or left the school</small>
              </div>

              <div class="modal-actions">
                <button type="submit" class="btn btn-primary" style="flex: 1;">Save Changes</button>
                <button type="button" class="btn" onclick="closeModal()" style="flex: 1; background: #6c757d; color: white;">Cancel</button>
              </div>
            </form>
          </div>
        </div>

        <script>
          let profiles = [];
          let currentFilter = 'all';
          let editingProfileId = null;

          // Load profiles on page load
          async function loadProfiles() {
            const loadingDiv = document.getElementById('loading');
            const container = document.getElementById('profiles-container');

            loadingDiv.style.display = 'block';
            container.innerHTML = '';

            try {
              const response = await fetch('/child-profiles');
              if (!response.ok) {
                throw new Error('Failed to load profiles');
              }

              const data = await response.json();
              profiles = data.profiles || [];

              renderProfiles();
            } catch (error) {
              showMessage('error', 'Failed to load profiles: ' + error.message);
            } finally {
              loadingDiv.style.display = 'none';
            }
          }

          function renderProfiles() {
            const container = document.getElementById('profiles-container');

            // Filter profiles based on current filter
            let filteredProfiles = profiles;
            if (currentFilter === 'active') {
              filteredProfiles = profiles.filter(p => p.is_active);
            } else if (currentFilter === 'inactive') {
              filteredProfiles = profiles.filter(p => !p.is_active);
            }

            if (filteredProfiles.length === 0) {
              container.innerHTML = \`
                <div class="empty-state">
                  <div class="empty-state-icon">👶</div>
                  <h2>No child profiles found</h2>
                  <p>Get started by running an analysis on your school emails or adding a child manually.</p>
                  <a href="/onboarding" class="btn btn-primary">🔍 Run Analysis</a>
                </div>
              \`;
              return;
            }

            container.innerHTML = '<div class="profiles-grid">' +
              filteredProfiles.map(profile => \`
                <div class="profile-card \${profile.is_active ? '' : 'inactive'}">
                  <div class="profile-header">
                    <div>
                      <div class="profile-name">\${escapeHtml(profile.real_name)}</div>
                      \${profile.display_name ? \`<div class="profile-alias">Alias: \${escapeHtml(profile.display_name)}</div>\` : ''}
                    </div>
                    <span class="status-badge \${profile.is_active ? 'status-active' : 'status-inactive'}">
                      \${profile.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div class="profile-details">
                    \${profile.year_group ? \`
                      <div class="profile-detail">
                        <span class="profile-detail-icon">📚</span>
                        <span>\${escapeHtml(profile.year_group)}</span>
                      </div>
                    \` : ''}
                    \${profile.school_name ? \`
                      <div class="profile-detail">
                        <span class="profile-detail-icon">🏫</span>
                        <span>\${escapeHtml(profile.school_name)}</span>
                      </div>
                    \` : ''}
                    \${profile.confidence_score !== null && profile.confidence_score !== undefined ? \`
                      <div class="profile-detail">
                        <span class="profile-detail-icon">🎯</span>
                        <span>Confidence: \${Math.round(profile.confidence_score * 100)}%</span>
                      </div>
                    \` : ''}
                  </div>

                  \${profile.notes ? \`
                    <div class="profile-notes">
                      📝 \${escapeHtml(profile.notes)}
                    </div>
                  \` : ''}

                  <div class="profile-actions">
                    <button class="btn-small btn-edit" onclick="editProfile(\${profile.id})">
                      ✏️ Edit
                    </button>
                    <button class="btn-small btn-delete" onclick="deleteProfile(\${profile.id}, '\${escapeHtml(profile.real_name)}')">
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              \`).join('') +
              '</div>';
          }

          function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function filterProfiles(filter) {
            currentFilter = filter;

            // Update button states
            document.querySelectorAll('.filter-btn').forEach(btn => {
              btn.classList.remove('active');
            });
            event.target.classList.add('active');

            renderProfiles();
          }

          function addChildManually() {
            editingProfileId = null;
            document.getElementById('modal-title').textContent = 'Add Child Manually';
            document.getElementById('edit-form').reset();
            document.getElementById('edit-profile-id').value = '';
            document.getElementById('edit-is-active').checked = true;
            document.getElementById('edit-modal').classList.add('active');
          }

          function editProfile(profileId) {
            const profile = profiles.find(p => p.id === profileId);
            if (!profile) return;

            editingProfileId = profileId;
            document.getElementById('modal-title').textContent = 'Edit Child Profile';
            document.getElementById('edit-profile-id').value = profileId;
            document.getElementById('edit-real-name').value = profile.real_name || '';
            document.getElementById('edit-display-name').value = profile.display_name || '';
            document.getElementById('edit-year-group').value = profile.year_group || '';
            document.getElementById('edit-school-name').value = profile.school_name || '';
            document.getElementById('edit-notes').value = profile.notes || '';
            document.getElementById('edit-is-active').checked = profile.is_active;
            document.getElementById('edit-modal').classList.add('active');
          }

          function closeModal() {
            document.getElementById('edit-modal').classList.remove('active');
            editingProfileId = null;
          }

          async function saveProfile(event) {
            event.preventDefault();

            const profileId = document.getElementById('edit-profile-id').value;
            const data = {
              real_name: document.getElementById('edit-real-name').value.trim(),
              display_name: document.getElementById('edit-display-name').value.trim() || undefined,
              year_group: document.getElementById('edit-year-group').value.trim() || undefined,
              school_name: document.getElementById('edit-school-name').value.trim() || undefined,
              notes: document.getElementById('edit-notes').value.trim() || undefined,
              is_active: document.getElementById('edit-is-active').checked,
            };

            try {
              let response;
              if (profileId) {
                // Update existing profile
                response = await fetch(\`/child-profiles/\${profileId}\`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data)
                });
              } else {
                // Create new profile
                const createData = {
                  profiles: [{
                    ...data,
                    display_name: data.display_name || '',
                    year_group: data.year_group || '',
                    school_name: data.school_name || '',
                    notes: data.notes || ''
                  }]
                };
                response = await fetch('/onboarding/confirm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(createData)
                });
              }

              if (!response.ok) {
                throw new Error('Failed to save profile');
              }

              showMessage('success', profileId ? 'Profile updated successfully!' : 'Child profile created successfully!');
              closeModal();
              await loadProfiles();
            } catch (error) {
              showMessage('error', 'Failed to save profile: ' + error.message);
            }
          }

          async function deleteProfile(profileId, childName) {
            if (!confirm(\`Are you sure you want to delete the profile for "\${childName}"? This action cannot be undone.\`)) {
              return;
            }

            try {
              const response = await fetch(\`/child-profiles/\${profileId}\`, {
                method: 'DELETE'
              });

              if (!response.ok) {
                throw new Error('Failed to delete profile');
              }

              showMessage('success', 'Profile deleted successfully');
              await loadProfiles();
            } catch (error) {
              showMessage('error', 'Failed to delete profile: ' + error.message);
            }
          }

          function showMessage(type, text) {
            const messageDiv = document.getElementById('message');
            messageDiv.className = 'message ' + type;
            messageDiv.textContent = text;
            messageDiv.style.display = 'block';

            setTimeout(() => {
              messageDiv.style.display = 'none';
            }, 5000);
          }

          // Close modal when clicking outside
          document.getElementById('edit-modal').addEventListener('click', function(e) {
            if (e.target === this) {
              closeModal();
            }
          });

          // Load profiles when page loads
          loadProfiles();
        </script>
      </body>
      </html>
    `;

    return reply.type('text/html').send(html);
  });
}
