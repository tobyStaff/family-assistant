// src/templates/settingsContent.ts

export interface SettingsContentOptions {
  summaryEmailRecipients: string[];
  summaryEnabled: boolean;
  summaryTimeUtc: number;
  timezone: string;
}

/**
 * Generate the settings content HTML (without layout wrapper)
 */
export function renderSettingsContent(options: SettingsContentOptions): string {
  const { summaryEmailRecipients, summaryEnabled, summaryTimeUtc, timezone } = options;

  const recipientsHtml = summaryEmailRecipients.length > 0
    ? summaryEmailRecipients.map((email, index) => `
        <div class="recipient-item">
          <span class="recipient-email">${email}</span>
          <button type="button" class="btn btn-danger btn-sm" onclick="removeRecipient(${index})">Remove</button>
        </div>
      `).join('')
    : '<div class="empty-state">No recipients added yet. Add your email below to receive daily summaries.</div>';

  return `
    <style>
      .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 20px;
      }

      .section-title {
        font-size: 16px;
        font-weight: 600;
        color: #333;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .form-group {
        margin-bottom: 20px;
      }

      .form-group label {
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
      input[type="text"],
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
        border-color: var(--primary-color);
      }

      .checkbox-group {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox-group input[type="checkbox"] {
        width: 20px;
        height: 20px;
        cursor: pointer;
      }

      .checkbox-group label {
        margin: 0;
        cursor: pointer;
      }

      .recipients-list {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        min-height: 100px;
        margin-bottom: 15px;
        background: #fafafa;
      }

      .recipient-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: white;
        border-radius: 6px;
        margin-bottom: 8px;
        border: 1px solid #e0e0e0;
      }

      .recipient-item:last-child {
        margin-bottom: 0;
      }

      .recipient-email {
        font-size: 14px;
        color: #333;
      }

      .add-recipient-form {
        display: flex;
        gap: 10px;
      }

      .add-recipient-form input {
        flex: 1;
      }

      .btn-sm {
        padding: 6px 12px;
        font-size: 12px;
      }

      .btn-save {
        width: 100%;
        padding: 14px 32px;
        font-size: 16px;
        font-weight: 600;
        margin-top: 10px;
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
        font-style: italic;
      }
    </style>

    <div id="message" class="message"></div>

    <form id="settingsForm">
      <div class="settings-grid">
        <!-- Email Recipients Section -->
        <div class="card">
          <div class="section-title">📧 Daily Summary Recipients</div>
          <div class="form-group">
            <label>Current Recipients:</label>
            <div class="recipients-list" id="recipientsList">
              ${recipientsHtml}
            </div>
            <div class="add-recipient-form">
              <input
                type="email"
                id="newRecipient"
                placeholder="Enter email address"
                onkeypress="if(event.key === 'Enter') { event.preventDefault(); addRecipient(); }"
              >
              <button type="button" class="btn btn-primary" onclick="addRecipient()">Add</button>
            </div>
            <div class="help-text">Add email addresses that should receive the daily summary.</div>
          </div>
        </div>

        <!-- Summary Settings -->
        <div class="card">
          <div class="section-title">🔔 Summary Settings</div>

          <div class="form-group">
            <div class="checkbox-group">
              <input
                type="checkbox"
                id="summaryEnabled"
                ${summaryEnabled ? 'checked' : ''}
              >
              <label for="summaryEnabled">Enable daily summary emails</label>
            </div>
            <div class="help-text">Turn this off to pause daily summary emails</div>
          </div>

          <div class="form-group">
            <label for="summaryTimeUtc">Time to send summary (UTC hour):</label>
            <input
              type="number"
              id="summaryTimeUtc"
              min="0"
              max="23"
              value="${summaryTimeUtc}"
            >
            <div class="help-text">
              Hour in UTC (0-23). Currently set to: <strong>${summaryTimeUtc}:00 UTC</strong>
              <br>
              <small>UK Examples: For 7am GMT set 7, for 7am BST (summer) set 6</small>
            </div>
            <div id="localTimePreview" class="help-text" style="margin-top: 5px; color: var(--primary-color);"></div>
          </div>

          <div class="form-group">
            <label for="timezone">Your timezone (for display only):</label>
            <input
              type="text"
              id="timezone"
              value="${timezone}"
              placeholder="e.g., Europe/London"
            >
            <div class="help-text">Your timezone for reference. The send time above must be set in UTC.</div>
          </div>
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-save">Save Settings</button>
    </form>
  `;
}

/**
 * Generate the settings JavaScript
 */
export function renderSettingsScripts(initialRecipients: string[]): string {
  return `
    <script>
      // Store recipients in memory
      let recipients = ${JSON.stringify(initialRecipients)};

      function renderRecipients() {
        const list = document.getElementById('recipientsList');
        if (recipients.length === 0) {
          list.innerHTML = '<div class="empty-state">No recipients added yet. Add your email below to receive daily summaries.</div>';
          return;
        }

        list.innerHTML = recipients.map((email, index) => \`
          <div class="recipient-item">
            <span class="recipient-email">\${email}</span>
            <button type="button" class="btn btn-danger btn-sm" onclick="removeRecipient(\${index})">Remove</button>
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

      // Show local time preview
      function updateLocalTimePreview() {
        const utcHour = parseInt(document.getElementById('summaryTimeUtc').value) || 0;
        const now = new Date();
        const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), utcHour, 0, 0));
        const localTime = utcDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
        document.getElementById('localTimePreview').innerHTML = 'In your local time: <strong>' + localTime + '</strong>';
      }
      document.getElementById('summaryTimeUtc').addEventListener('input', updateLocalTimePreview);
      updateLocalTimePreview();

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
  `;
}
