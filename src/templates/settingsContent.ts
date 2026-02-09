// src/templates/settingsContent.ts

import type { SubscriptionTier, TierFeature } from '../types/subscription.js';

export interface SettingsContentOptions {
  summaryEmailRecipients: string[];
  summaryEnabled: boolean;
  summaryTimeUtc: number;
  timezone: string;
  emailSource?: 'gmail' | 'hosted';
  hostedAlias?: string | null;
  hostedEmail?: string | null;
  hostedDomain?: string;
  calendarConnected?: boolean;
  // Subscription options
  subscription?: {
    tier: SubscriptionTier;
    tierDisplayName: string;
    priceFormatted: string;
    status: string;
    features: TierFeature[];
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    trialEnd?: string | null;
    hasStripeSubscription?: boolean;
  };
}

/**
 * Generate the settings content HTML (without layout wrapper)
 */
export function renderSettingsContent(options: SettingsContentOptions): string {
  const {
    summaryEmailRecipients,
    summaryEnabled,
    summaryTimeUtc,
    timezone,
    emailSource = 'gmail',
    hostedAlias,
    hostedEmail,
    hostedDomain = 'inbox.getfamilyassistant.com',
    calendarConnected = false,
    subscription,
  } = options;

  // Generate subscription section HTML
  const subscriptionHtml = subscription ? generateSubscriptionSection(subscription) : '';

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
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
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
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: 8px;
        font-size: 14px;
      }

      .help-text {
        font-size: 13px;
        color: var(--text-muted);
        margin-top: 5px;
      }

      input[type="email"],
      input[type="number"],
      input[type="text"],
      select {
        width: 100%;
        padding: 12px 14px;
        border: 2px solid var(--border-light);
        border-radius: var(--radius-md);
        font-size: 14px;
        font-family: var(--font-body);
        transition: border-color 0.2s, box-shadow 0.2s;
      }

      input:focus,
      select:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px var(--primary-light);
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
        border: 2px solid var(--border-light);
        border-radius: var(--radius-md);
        padding: 15px;
        min-height: 100px;
        margin-bottom: 15px;
        background: var(--bg-muted);
      }

      .recipient-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        background: var(--bg-card);
        border-radius: var(--radius-sm);
        margin-bottom: 8px;
        border: 1px solid var(--border-light);
      }

      .recipient-item:last-child {
        margin-bottom: 0;
      }

      .recipient-email {
        font-size: 14px;
        color: var(--text-primary);
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
        padding: 14px 16px;
        border-radius: var(--radius-md);
        margin-bottom: 20px;
        display: none;
        font-weight: 500;
      }

      .message.success {
        background: var(--success-light);
        color: #2E7D32;
        border: 1px solid #A5D6A7;
      }

      .message.error {
        background: var(--danger-light);
        color: var(--danger-dark);
        border: 1px solid #FFCDD2;
      }

      .empty-state {
        text-align: center;
        color: var(--text-muted);
        padding: 20px;
        font-size: 14px;
        font-style: italic;
      }

      /* Email Source Styles */
      .email-source-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .source-option {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        border: 2px solid var(--border-light);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all 0.2s;
      }

      .source-option:hover {
        border-color: var(--primary-color);
        background: var(--bg-muted);
      }

      .source-option.selected {
        border-color: var(--primary-color);
        background: var(--sky);
      }

      .source-option input[type="radio"] {
        margin-top: 3px;
        width: 18px;
        height: 18px;
        accent-color: var(--primary-color);
      }

      .source-option-content {
        flex: 1;
      }

      .source-option-title {
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 4px;
      }

      .source-option-desc {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
      }

      .alias-config {
        margin-top: 15px;
        padding: 16px;
        background: var(--bg-muted);
        border-radius: var(--radius-md);
        display: none;
      }

      .alias-config.visible {
        display: block;
      }

      .alias-input-group {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
      }

      .alias-input-group input {
        flex: 1;
        max-width: 200px;
      }

      .alias-domain {
        color: var(--text-secondary);
        font-size: 14px;
      }

      .alias-status {
        margin-top: 10px;
        padding: 12px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-weight: 500;
        display: none;
      }

      .alias-status.checking {
        display: block;
        background: var(--warning-light);
        color: #92400E;
      }

      .alias-status.available {
        display: block;
        background: var(--success-light);
        color: #2E7D32;
      }

      .alias-status.taken {
        display: block;
        background: var(--danger-light);
        color: var(--danger-dark);
      }

      .alias-status.owned {
        display: block;
        background: var(--sky);
        color: var(--primary-dark);
      }

      .current-hosted-email {
        margin-top: 12px;
        padding: 14px;
        background: var(--sky);
        border-radius: var(--radius-sm);
        font-size: 14px;
      }

      .current-hosted-email strong {
        color: var(--primary-color);
      }
    </style>

    <div id="message" class="message"></div>

    ${subscriptionHtml}

    <form id="settingsForm">
      <div class="settings-grid">
        <!-- Email Source Section -->
        <div class="card">
          <div class="section-title">📬 Email Source</div>
          <p class="help-text" style="margin-bottom: 15px;">Choose how you want to receive emails for processing.</p>

          <div class="email-source-options">
            <label class="source-option ${emailSource === 'gmail' ? 'selected' : ''}" id="gmailOption">
              <input
                type="radio"
                name="emailSource"
                value="gmail"
                ${emailSource === 'gmail' ? 'checked' : ''}
                onchange="selectEmailSource('gmail')"
              >
              <div class="source-option-content">
                <div class="source-option-title">Gmail Integration</div>
                <div class="source-option-desc">
                  Connect your Gmail account and we'll automatically fetch and process your emails.
                  Requires Google OAuth sign-in.
                </div>
              </div>
            </label>

            <label class="source-option ${emailSource === 'hosted' ? 'selected' : ''}" id="hostedOption">
              <input
                type="radio"
                name="emailSource"
                value="hosted"
                ${emailSource === 'hosted' ? 'checked' : ''}
                onchange="selectEmailSource('hosted')"
              >
              <div class="source-option-content">
                <div class="source-option-title">Forwarding Address</div>
                <div class="source-option-desc">
                  Get a personal forwarding address. Set up auto-forwarding from your school or other email to send messages here.
                </div>
              </div>
            </label>
          </div>

          <div class="alias-config ${emailSource === 'hosted' ? 'visible' : ''}" id="aliasConfig">
            <label style="font-weight: 500; color: #555; font-size: 14px;">Your forwarding address:</label>
            <div class="alias-input-group">
              <input
                type="text"
                id="hostedAlias"
                placeholder="yourname"
                value="${hostedAlias || ''}"
                oninput="checkAliasAvailability()"
                pattern="[a-z0-9]+"
                style="text-transform: lowercase;"
              >
              <span class="alias-domain">@${hostedDomain}</span>
            </div>
            <div class="alias-status" id="aliasStatus"></div>
            ${hostedEmail ? `
              <div class="current-hosted-email">
                Your current address: <strong>${hostedEmail}</strong>
                <br><small>Forward emails to this address to have them processed.</small>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Google Calendar Integration -->
        <div class="card">
          <div class="section-title">📅 Google Calendar Integration</div>
          <p class="help-text" style="margin-bottom: 15px;">Sync extracted events to your Google Calendar automatically.</p>

          <div id="calendarStatus" style="padding: 15px; border-radius: 8px; ${calendarConnected ? 'background: #d4edda; border: 1px solid #c3e6cb;' : 'background: #f8f9fa; border: 1px solid #e0e0e0;'}">
            ${calendarConnected ? `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 600; color: #155724; margin-bottom: 4px;">✅ Connected</div>
                  <div style="font-size: 13px; color: #666;">Events will automatically sync to your Google Calendar.</div>
                </div>
                <button type="button" class="btn btn-danger" onclick="disconnectCalendar()" id="disconnectCalendarBtn">Disconnect</button>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 600; color: #333; margin-bottom: 4px;">Not connected</div>
                  <div style="font-size: 13px; color: #666;">Connect to sync school events to your calendar.</div>
                </div>
                <a href="/auth/google/connect-calendar" class="btn btn-primary" style="text-decoration: none;">Connect Calendar</a>
              </div>
            `}
          </div>
        </div>

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
export function renderSettingsScripts(initialRecipients: string[], initialEmailSource: string = 'gmail'): string {
  return `
    <script>
      // Store recipients in memory
      let recipients = ${JSON.stringify(initialRecipients)};
      let currentEmailSource = '${initialEmailSource}';
      let aliasCheckTimeout = null;
      let lastCheckedAlias = '';

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

      // Email source functions
      function selectEmailSource(source) {
        currentEmailSource = source;

        // Update UI
        document.getElementById('gmailOption').classList.toggle('selected', source === 'gmail');
        document.getElementById('hostedOption').classList.toggle('selected', source === 'hosted');

        const aliasConfig = document.getElementById('aliasConfig');
        if (source === 'hosted') {
          aliasConfig.classList.add('visible');
          // Check alias if there's a value
          const aliasInput = document.getElementById('hostedAlias');
          if (aliasInput.value) {
            checkAliasAvailability();
          }
        } else {
          aliasConfig.classList.remove('visible');
        }
      }

      function checkAliasAvailability() {
        const aliasInput = document.getElementById('hostedAlias');
        const statusEl = document.getElementById('aliasStatus');
        let alias = aliasInput.value.toLowerCase().trim();

        // Force lowercase
        aliasInput.value = alias;

        // Clear previous timeout
        if (aliasCheckTimeout) {
          clearTimeout(aliasCheckTimeout);
        }

        // Validate format locally first
        if (!alias) {
          statusEl.className = 'alias-status';
          statusEl.textContent = '';
          return;
        }

        if (!/^[a-z0-9]+$/.test(alias)) {
          statusEl.className = 'alias-status taken';
          statusEl.textContent = 'Only lowercase letters and numbers allowed';
          return;
        }

        if (alias.length < 3) {
          statusEl.className = 'alias-status taken';
          statusEl.textContent = 'Alias must be at least 3 characters';
          return;
        }

        if (alias.length > 30) {
          statusEl.className = 'alias-status taken';
          statusEl.textContent = 'Alias must be 30 characters or less';
          return;
        }

        // Skip if same as last check
        if (alias === lastCheckedAlias) {
          return;
        }

        statusEl.className = 'alias-status checking';
        statusEl.textContent = 'Checking availability...';

        // Debounce the API call
        aliasCheckTimeout = setTimeout(async () => {
          try {
            const response = await fetch('/api/settings/check-alias?alias=' + encodeURIComponent(alias));
            const data = await response.json();
            lastCheckedAlias = alias;

            if (data.owned) {
              statusEl.className = 'alias-status owned';
              statusEl.textContent = 'You own this alias';
            } else if (data.available) {
              statusEl.className = 'alias-status available';
              statusEl.textContent = 'Available!';
            } else {
              statusEl.className = 'alias-status taken';
              statusEl.textContent = data.reason || 'Already taken';
            }
          } catch (error) {
            statusEl.className = 'alias-status taken';
            statusEl.textContent = 'Error checking availability';
          }
        }, 300);
      }

      async function saveEmailSource() {
        const source = currentEmailSource;
        const alias = source === 'hosted' ? document.getElementById('hostedAlias').value.toLowerCase().trim() : null;

        if (source === 'hosted' && !alias) {
          showMessage('Please enter an alias for your forwarding address', 'error');
          return false;
        }

        try {
          const response = await fetch('/api/settings/email-source', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, alias }),
          });

          const data = await response.json();

          if (!response.ok) {
            showMessage('Error: ' + (data.error || 'Failed to update email source'), 'error');
            return false;
          }

          // Update the hosted email display if we got one
          if (data.hostedEmail) {
            const currentDisplay = document.querySelector('.current-hosted-email');
            if (currentDisplay) {
              currentDisplay.innerHTML = 'Your current address: <strong>' + data.hostedEmail + '</strong><br><small>Forward emails to this address to have them processed.</small>';
            } else {
              const aliasConfig = document.getElementById('aliasConfig');
              const newDisplay = document.createElement('div');
              newDisplay.className = 'current-hosted-email';
              newDisplay.innerHTML = 'Your current address: <strong>' + data.hostedEmail + '</strong><br><small>Forward emails to this address to have them processed.</small>';
              aliasConfig.appendChild(newDisplay);
            }
          }

          return true;
        } catch (error) {
          showMessage('Error: Failed to update email source', 'error');
          return false;
        }
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

        try {
          // First save email source if needed
          const emailSourceSaved = await saveEmailSource();
          if (!emailSourceSaved) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Settings';
            return;
          }

          // Then save other settings
          const settings = {
            summaryEmailRecipients: recipients,
            summaryEnabled: document.getElementById('summaryEnabled').checked,
            summaryTimeUtc: parseInt(document.getElementById('summaryTimeUtc').value),
            timezone: document.getElementById('timezone').value,
          };

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

      // ============================================
      // CALENDAR INTEGRATION
      // ============================================
      async function disconnectCalendar() {
        const btn = document.getElementById('disconnectCalendarBtn');
        if (!confirm('Are you sure you want to disconnect Google Calendar? Events will no longer sync.')) {
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Disconnecting...';

        try {
          const response = await fetch('/api/settings/disconnect-calendar', { method: 'POST' });
          const data = await response.json();

          if (response.ok) {
            // Update UI to show disconnected state
            const statusEl = document.getElementById('calendarStatus');
            statusEl.style.background = '#f8f9fa';
            statusEl.style.border = '1px solid #e0e0e0';
            statusEl.innerHTML = \`
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 600; color: #333; margin-bottom: 4px;">Not connected</div>
                  <div style="font-size: 13px; color: #666;">Connect to sync school events to your calendar.</div>
                </div>
                <a href="/auth/google/connect-calendar" class="btn btn-primary" style="text-decoration: none;">Connect Calendar</a>
              </div>
            \`;
            showMessage('Google Calendar disconnected', 'success');
          } else {
            showMessage('Error: ' + (data.error || 'Failed to disconnect'), 'error');
            btn.disabled = false;
            btn.textContent = 'Disconnect';
          }
        } catch (error) {
          showMessage('Error: Failed to disconnect calendar', 'error');
          btn.disabled = false;
          btn.textContent = 'Disconnect';
        }
      }

      // Check if calendar was just connected (from OAuth callback)
      if (new URLSearchParams(window.location.search).get('calendar_connected') === '1') {
        showMessage('Google Calendar connected successfully!', 'success');
        // Clean up URL
        window.history.replaceState({}, document.title, '/settings');
      }

      // Check for checkout success
      const checkoutStatus = new URLSearchParams(window.location.search).get('checkout');
      if (checkoutStatus === 'success') {
        showMessage('Your subscription has been updated successfully!', 'success');
        window.history.replaceState({}, document.title, '/settings');
      } else if (checkoutStatus === 'canceled') {
        showMessage('Checkout was canceled.', 'error');
        window.history.replaceState({}, document.title, '/settings');
      }
    </script>
  `;
}

/**
 * Generate subscription section HTML
 */
function generateSubscriptionSection(subscription: NonNullable<SettingsContentOptions['subscription']>): string {
  const {
    tier,
    tierDisplayName,
    priceFormatted,
    status,
    features,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd,
    hasStripeSubscription,
  } = subscription;

  // Status badge
  const statusBadge = getStatusBadge(status, cancelAtPeriodEnd);

  // Trial or cancellation notice
  let noticeHtml = '';
  if (trialEnd) {
    const trialEndDate = new Date(trialEnd).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    noticeHtml = `
      <div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px; padding: 12px; margin-bottom: 15px;">
        <strong>Trial ends ${trialEndDate}</strong><br>
        <small>Your card will be charged when the trial ends.</small>
      </div>
    `;
  } else if (cancelAtPeriodEnd && currentPeriodEnd) {
    const endDate = new Date(currentPeriodEnd).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    noticeHtml = `
      <div style="background: #FEE2E2; border: 1px solid #EF4444; border-radius: 8px; padding: 12px; margin-bottom: 15px;">
        <strong>Subscription ends ${endDate}</strong><br>
        <small>Your subscription will not renew. You'll be downgraded to the Free plan.</small>
      </div>
    `;
  }

  // Feature list with availability indicators
  const allFeatures: { feature: TierFeature; label: string; tier: 'ORGANIZED' | 'PROFESSIONAL' | 'CONCIERGE' }[] = [
    { feature: 'daily_brief', label: 'Daily Brief', tier: 'ORGANIZED' },
    { feature: 'attachment_analysis', label: 'Attachment Analysis', tier: 'ORGANIZED' },
    { feature: 'custom_training', label: 'Custom Training', tier: 'ORGANIZED' },
    { feature: 'hosted_email', label: 'Hosted Email', tier: 'PROFESSIONAL' },
    { feature: 'calendar_sync', label: 'Calendar Sync', tier: 'PROFESSIONAL' },
    { feature: 'ai_vision', label: 'AI Vision', tier: 'PROFESSIONAL' },
    { feature: 'unlimited_senders', label: 'Unlimited Senders', tier: 'PROFESSIONAL' },
    { feature: 'whatsapp_integration', label: 'WhatsApp Integration', tier: 'CONCIERGE' },
    { feature: 'human_verification', label: 'Human Verification', tier: 'CONCIERGE' },
    { feature: 'autopilot_tasks', label: 'Autopilot Tasks', tier: 'CONCIERGE' },
  ];

  const featuresHtml = allFeatures.map(f => {
    const available = features.includes(f.feature);
    return `
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-light);">
        <span style="font-size: 16px;">${available ? '✅' : '🔒'}</span>
        <span style="flex: 1; color: ${available ? 'var(--text-primary)' : 'var(--text-muted)'}; ${!available ? 'opacity: 0.7;' : ''}">${f.label}</span>
        ${!available ? `<span style="font-size: 11px; background: var(--bg-muted); padding: 2px 6px; border-radius: 4px; color: var(--text-muted);">Requires ${f.tier}</span>` : ''}
      </div>
    `;
  }).join('');

  // Upgrade/manage buttons
  let actionButtonsHtml = '';
  if (tier === 'FREE') {
    actionButtonsHtml = `
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button type="button" class="btn btn-primary" onclick="upgradePlan('ORGANIZED')">Upgrade to Organized — £9/mo</button>
        <button type="button" class="btn btn-secondary" onclick="upgradePlan('PROFESSIONAL')">Go Professional — £18/mo</button>
      </div>
    `;
  } else if (hasStripeSubscription) {
    actionButtonsHtml = `
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <a href="/api/checkout/billing-portal" class="btn btn-secondary" style="text-decoration: none;">Manage Billing</a>
        ${tier !== 'CONCIERGE' ? `<button type="button" class="btn btn-primary" onclick="upgradePlan('${tier === 'ORGANIZED' ? 'PROFESSIONAL' : 'CONCIERGE'}')">Upgrade Plan</button>` : ''}
      </div>
    `;
  }

  return `
    <div id="subscription" class="card" style="margin-bottom: 20px;">
      <style>
        .subscription-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
        }
        .subscription-plan {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .plan-name {
          font-family: var(--font-display);
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .plan-price {
          font-size: 14px;
          color: var(--text-secondary);
        }
        .status-badge {
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .status-active {
          background: #D1FAE5;
          color: #065F46;
        }
        .status-trialing {
          background: #DBEAFE;
          color: #1E40AF;
        }
        .status-past_due {
          background: #FEE2E2;
          color: #991B1B;
        }
        .status-canceled {
          background: #F3F4F6;
          color: #6B7280;
        }
        .features-grid {
          margin: 20px 0;
          max-height: 300px;
          overflow-y: auto;
        }
      </style>

      <div class="section-title">💳 Your Subscription</div>

      ${noticeHtml}

      <div class="subscription-header">
        <div class="subscription-plan">
          <div>
            <div class="plan-name">${tierDisplayName}</div>
            <div class="plan-price">${tier === 'FREE' ? 'Free forever' : `${priceFormatted}/month`}</div>
          </div>
        </div>
        ${statusBadge}
      </div>

      <div class="features-grid">
        ${featuresHtml}
      </div>

      ${actionButtonsHtml}
    </div>

    <script>
      async function upgradePlan(tier) {
        try {
          const response = await fetch('/api/checkout/create-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier }),
          });

          const data = await response.json();

          if (response.ok && data.url) {
            window.location.href = data.url;
          } else {
            alert('Error: ' + (data.message || 'Failed to start checkout'));
          }
        } catch (error) {
          alert('Error: Failed to start checkout');
        }
      }
    </script>
  `;
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status: string, cancelAtPeriodEnd?: boolean): string {
  if (cancelAtPeriodEnd) {
    return '<span class="status-badge status-canceled">Canceling</span>';
  }

  switch (status) {
    case 'active':
      return '<span class="status-badge status-active">Active</span>';
    case 'trialing':
      return '<span class="status-badge status-trialing">Trial</span>';
    case 'past_due':
      return '<span class="status-badge status-past_due">Past Due</span>';
    case 'canceled':
      return '<span class="status-badge status-canceled">Canceled</span>';
    default:
      return `<span class="status-badge">${status}</span>`;
  }
}
