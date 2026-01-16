// src/routes/settingsRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { upsertSettings, getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { getUser } from '../db/userDb.js';

/**
 * Zod schema for PUT /settings request validation
 */
const UpdateSettingsSchema = z.object({
  summaryEmailRecipients: z.array(z.string().email()).optional(),
  summaryEnabled: z.boolean().optional(),
  summaryTimeUtc: z.number().int().min(0).max(23).optional(),
  timezone: z.string().optional(),
});

/**
 * Register settings-related routes
 *
 * @param fastify - Fastify instance
 */
export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /settings
   * Get current user settings (HTML UI or JSON API)
   */
  fastify.get('/settings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const user = getUser(userId);

      // Get settings or return defaults if not found
      const settings = getOrCreateDefaultSettings(userId);

      // Check if request wants HTML (browser) or JSON (API)
      const acceptHeader = request.headers.accept || '';
      const wantsHtml = acceptHeader.includes('text/html');

      if (wantsHtml) {
        // Render HTML settings page
        const recipientsHtml = settings.summary_email_recipients
          .map(
            (email, index) => `
            <div class="recipient-item">
              <span class="recipient-email">${email}</span>
              <button type="button" class="btn-remove" onclick="removeRecipient(${index})">Remove</button>
            </div>
          `
          )
          .join('');

        const html = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Settings - Inbox Manager</title>
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
                max-width: 800px;
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
              .user-info {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 30px;
              }
              .user-info p {
                margin: 5px 0;
                color: #666;
              }
              .section {
                margin-bottom: 30px;
              }
              .section-title {
                font-size: 18px;
                font-weight: 600;
                color: #333;
                margin-bottom: 15px;
              }
              .form-group {
                margin-bottom: 20px;
              }
              label {
                display: block;
                font-weight: 500;
                color: #555;
                margin-bottom: 8px;
                font-size: 14px;
              }
              .help-text {
                font-size: 13px;
                color: #888;
                margin-top: 5px;
              }
              input[type="email"],
              input[type="number"],
              select {
                width: 100%;
                padding: 12px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 14px;
                transition: border-color 0.3s;
              }
              input:focus,
              select:focus {
                outline: none;
                border-color: #667eea;
              }
              .checkbox-group {
                display: flex;
                align-items: center;
                gap: 10px;
              }
              input[type="checkbox"] {
                width: 20px;
                height: 20px;
                cursor: pointer;
              }
              .recipients-list {
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 15px;
                min-height: 100px;
                margin-bottom: 15px;
              }
              .recipient-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                background: #f8f9fa;
                border-radius: 6px;
                margin-bottom: 8px;
              }
              .recipient-email {
                font-size: 14px;
                color: #333;
              }
              .btn-remove {
                background: #dc3545;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              }
              .btn-remove:hover {
                background: #c82333;
              }
              .add-recipient-form {
                display: flex;
                gap: 10px;
              }
              .add-recipient-form input {
                flex: 1;
              }
              .btn-add {
                background: #28a745;
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                white-space: nowrap;
              }
              .btn-add:hover {
                background: #218838;
              }
              .btn-save {
                background: #667eea;
                color: white;
                border: none;
                padding: 14px 32px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 600;
                width: 100%;
                transition: background 0.3s;
              }
              .btn-save:hover {
                background: #5568d3;
              }
              .btn-save:disabled {
                background: #ccc;
                cursor: not-allowed;
              }
              .message {
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 20px;
                display: none;
              }
              .message.success {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
              }
              .message.error {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
              }
              .empty-state {
                text-align: center;
                color: #999;
                padding: 20px;
                font-size: 14px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>⚙️ Settings</h1>
                <a href="/dashboard" class="back-link">← Back to Dashboard</a>
              </div>

              <div class="user-info">
                <p><strong>Logged in as:</strong> ${user?.email || 'Unknown'}</p>
                <p><strong>Name:</strong> ${user?.name || 'N/A'}</p>
              </div>

              <div id="message" class="message"></div>

              <form id="settingsForm">
                <!-- Email Recipients Section -->
                <div class="section">
                  <div class="section-title">📧 Daily Summary Email Recipients</div>
                  <div class="form-group">
                    <label>Current Recipients:</label>
                    <div class="recipients-list" id="recipientsList">
                      ${recipientsHtml || '<div class="empty-state">No recipients added yet. Add your email below to receive daily summaries.</div>'}
                    </div>
                    <div class="add-recipient-form">
                      <input
                        type="email"
                        id="newRecipient"
                        placeholder="Enter email address"
                        onkeypress="if(event.key === 'Enter') { event.preventDefault(); addRecipient(); }"
                      >
                      <button type="button" class="btn-add" onclick="addRecipient()">Add Email</button>
                    </div>
                    <div class="help-text">Add email addresses that should receive the daily summary. You can add multiple recipients.</div>
                  </div>
                </div>

                <!-- Summary Enabled Section -->
                <div class="section">
                  <div class="section-title">🔔 Daily Summary Status</div>
                  <div class="form-group">
                    <div class="checkbox-group">
                      <input
                        type="checkbox"
                        id="summaryEnabled"
                        ${settings.summary_enabled ? 'checked' : ''}
                      >
                      <label for="summaryEnabled" style="margin: 0;">Enable daily summary emails</label>
                    </div>
                    <div class="help-text">Turn this off to pause daily summary emails</div>
                  </div>
                </div>

                <!-- Summary Time Section -->
                <div class="section">
                  <div class="section-title">🕐 Summary Time</div>
                  <div class="form-group">
                    <label for="summaryTimeUtc">Time to send summary (UTC hour):</label>
                    <input
                      type="number"
                      id="summaryTimeUtc"
                      min="0"
                      max="23"
                      value="${settings.summary_time_utc}"
                    >
                    <div class="help-text">Hour in UTC (0-23). Current: ${settings.summary_time_utc}:00 UTC</div>
                  </div>
                </div>

                <!-- Timezone Section -->
                <div class="section">
                  <div class="section-title">🌍 Timezone</div>
                  <div class="form-group">
                    <label for="timezone">Your timezone:</label>
                    <input
                      type="text"
                      id="timezone"
                      value="${settings.timezone}"
                      placeholder="e.g., America/New_York, Europe/London"
                    >
                    <div class="help-text">IANA timezone identifier (e.g., America/New_York, Europe/London)</div>
                  </div>
                </div>

                <button type="submit" class="btn-save">Save Settings</button>
              </form>
            </div>

            <script>
              // Store recipients in memory
              let recipients = ${JSON.stringify(settings.summary_email_recipients)};

              function renderRecipients() {
                const list = document.getElementById('recipientsList');
                if (recipients.length === 0) {
                  list.innerHTML = '<div class="empty-state">No recipients added yet. Add your email below to receive daily summaries.</div>';
                  return;
                }

                list.innerHTML = recipients.map((email, index) => \`
                  <div class="recipient-item">
                    <span class="recipient-email">\${email}</span>
                    <button type="button" class="btn-remove" onclick="removeRecipient(\${index})">Remove</button>
                  </div>
                \`).join('');
              }

              function addRecipient() {
                const input = document.getElementById('newRecipient');
                const email = input.value.trim();

                if (!email) {
                  showMessage('Please enter an email address', 'error');
                  return;
                }

                // Basic email validation
                if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
                  showMessage('Please enter a valid email address', 'error');
                  return;
                }

                // Check for duplicates
                if (recipients.includes(email)) {
                  showMessage('This email is already in the list', 'error');
                  return;
                }

                recipients.push(email);
                renderRecipients();
                input.value = '';
                showMessage('Email added. Click "Save Settings" to apply changes.', 'success');
              }

              function removeRecipient(index) {
                recipients.splice(index, 1);
                renderRecipients();
                showMessage('Email removed. Click "Save Settings" to apply changes.', 'success');
              }

              function showMessage(text, type) {
                const msg = document.getElementById('message');
                msg.textContent = text;
                msg.className = 'message ' + type;
                msg.style.display = 'block';
                setTimeout(() => {
                  msg.style.display = 'none';
                }, 5000);
              }

              document.getElementById('settingsForm').addEventListener('submit', async (e) => {
                e.preventDefault();

                const submitBtn = e.target.querySelector('.btn-save');
                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving...';

                const settings = {
                  summaryEmailRecipients: recipients,
                  summaryEnabled: document.getElementById('summaryEnabled').checked,
                  summaryTimeUtc: parseInt(document.getElementById('summaryTimeUtc').value),
                  timezone: document.getElementById('timezone').value,
                };

                try {
                  const response = await fetch('/settings', {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(settings),
                  });

                  const data = await response.json();

                  if (response.ok) {
                    showMessage('Settings saved successfully!', 'success');
                  } else {
                    showMessage('Error: ' + (data.error || 'Failed to save settings'), 'error');
                  }
                } catch (error) {
                  showMessage('Error: Failed to save settings', 'error');
                } finally {
                  submitBtn.disabled = false;
                  submitBtn.textContent = 'Save Settings';
                }
              });
            </script>
          </body>
          </html>
        `;

        return reply.type('text/html').send(html);
      } else {
        // Return JSON for API requests
        return reply.code(200).send({
          summaryEmailRecipients: settings.summary_email_recipients,
          summaryEnabled: settings.summary_enabled,
          summaryTimeUtc: settings.summary_time_utc,
          timezone: settings.timezone,
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error getting settings');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * PUT /settings
   * Update user settings
   */
  fastify.put<{
    Body: z.infer<typeof UpdateSettingsSchema>;
  }>('/settings', { preHandler: requireAuth }, async (request, reply) => {
    // Validate body
    const bodyResult = UpdateSettingsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);

      // Get existing settings or defaults
      const currentSettings = getOrCreateDefaultSettings(userId);

      // Merge with new values
      const updatedSettings = {
        user_id: userId,
        summary_email_recipients: bodyResult.data.summaryEmailRecipients ?? currentSettings.summary_email_recipients,
        summary_enabled: bodyResult.data.summaryEnabled ?? currentSettings.summary_enabled,
        summary_time_utc: bodyResult.data.summaryTimeUtc ?? currentSettings.summary_time_utc,
        timezone: bodyResult.data.timezone ?? currentSettings.timezone,
      };

      // Save to database
      upsertSettings(updatedSettings);

      fastify.log.info({ userId }, 'Settings updated successfully');

      return reply.code(200).send({
        success: true,
        message: 'Settings updated',
        settings: {
          summaryEmailRecipients: updatedSettings.summary_email_recipients,
          summaryEnabled: updatedSettings.summary_enabled,
          summaryTimeUtc: updatedSettings.summary_time_utc,
          timezone: updatedSettings.timezone,
        },
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating settings');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });
}
