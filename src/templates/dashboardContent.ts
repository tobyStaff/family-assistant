// src/templates/dashboardContent.ts
import type { Role } from '../types/roles.js';
import { isAdmin } from '../types/roles.js';

interface UpcomingEvent {
  id: number;
  title: string;
  date: string | Date;
  child_name?: string;
  location?: string;
  sync_status: string;
}

interface DashboardOptions {
  userIsAdmin: boolean;
  upcomingEvents: UpcomingEvent[];
}

/**
 * Generate the dashboard content HTML (without layout wrapper)
 */
export function renderDashboardContent(options: DashboardOptions): string {
  const { userIsAdmin, upcomingEvents } = options;

  const eventsHtml = upcomingEvents.length > 0
    ? upcomingEvents.map(event => `
        <div class="event-card">
          <div class="event-header">
            <span class="event-title">${event.title}</span>
            <span class="status-badge status-${event.sync_status}">
              ${event.sync_status === 'synced' ? '✓ Synced' :
                event.sync_status === 'pending' ? '⏳ Pending' : '⚠ Failed'}
            </span>
          </div>
          <div class="event-date">
            📆 ${(event.date instanceof Date ? event.date : new Date(event.date)).toLocaleDateString('en-GB', {
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
      `).join('')
    : '<div class="empty-state">No upcoming events in the next 7 days</div>';

  return `
    <style>
      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
        gap: 20px;
      }

      .welcome-card {
        grid-column: 1 / -1;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .welcome-card h2 {
        margin: 0 0 10px 0;
        font-size: 24px;
      }

      .welcome-card p {
        margin: 0;
        opacity: 0.9;
      }

      .onboarding-card {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 24px;
        border-radius: 12px;
        display: none;
      }

      .onboarding-card h3 {
        margin: 0 0 10px 0;
      }

      .onboarding-card p {
        margin: 0 0 15px 0;
        opacity: 0.9;
      }

      .onboarding-card .btn {
        background: white;
        color: #f5576c;
      }

      .event-card {
        background: #f8f9fa;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        border-left: 4px solid var(--primary-color);
      }

      .event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .event-title {
        font-weight: 600;
        color: #333;
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
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 600;
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

      .empty-state {
        text-align: center;
        color: #666;
        font-style: italic;
        padding: 30px;
      }

      .quick-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 15px;
      }

      .action-result {
        margin-top: 15px;
        padding: 12px;
        border-radius: 8px;
        display: none;
      }

      .action-result.success {
        background: #d4edda;
        color: #155724;
      }

      .action-result.error {
        background: #f8d7da;
        color: #721c24;
      }

      .admin-section {
        border: 2px dashed #e0e0e0;
        border-radius: 12px;
        padding: 20px;
        background: #fafafa;
      }

      .admin-section-title {
        color: #dc3545;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .danger-zone {
        border-color: #f8d7da;
        background: #fff5f5;
      }
    </style>

    <div class="dashboard-grid">
      <!-- Welcome Card -->
      <div class="welcome-card">
        <h2>👋 Welcome to Inbox Manager</h2>
        <p>Your personal productivity hub for managing school emails and family tasks.</p>
      </div>

      <!-- Onboarding Card (hidden by default) -->
      <div class="card onboarding-card" id="onboarding-card">
        <h3>🚀 Get Started</h3>
        <p>Set up child profiles to personalize your experience. We'll analyze your emails to automatically detect your children's information.</p>
        <a href="/child-profiles-manage" class="btn">Set Up Profiles</a>
      </div>

      <!-- Upcoming Events -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📅 Upcoming Events</h3>
          <a href="/events-view" class="btn btn-outline" style="font-size: 12px; padding: 6px 12px;">View All</a>
        </div>
        ${eventsHtml}
        ${userIsAdmin ? `
          <div class="quick-actions">
            <button class="btn btn-primary" id="sync-events-btn" onclick="syncEvents()">
              🔄 Sync to Calendar
            </button>
          </div>
          <div class="action-result" id="sync-events-result"></div>
        ` : ''}
      </div>

      <!-- Quick Links -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">⚡ Quick Links</h3>
        </div>
        <div style="display: grid; gap: 10px;">
          <a href="/todos-view" class="btn btn-outline" style="justify-content: flex-start;">
            📝 View All TODOs
          </a>
          <a href="/child-profiles-manage" class="btn btn-outline" style="justify-content: flex-start;">
            👶 Manage Child Profiles
          </a>
          <a href="/settings" class="btn btn-outline" style="justify-content: flex-start;">
            ⚙️ Settings
          </a>
        </div>
      </div>

      ${userIsAdmin ? `
      <!-- Admin: Summary Actions -->
      <div class="card admin-section">
        <div class="admin-section-title">🔧 Admin Tools</div>
        <div class="card-header">
          <h3 class="card-title">✨ Daily Summary</h3>
        </div>
        <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
          Preview or send the personalized daily summary email.
        </p>
        <div class="quick-actions">
          <button class="btn btn-outline" id="preview-btn" onclick="previewPersonalizedSummary()">
            👁️ Preview
          </button>
          <button class="btn btn-primary" id="send-summary-btn" onclick="sendDailySummary()">
            📧 Send Summary
          </button>
        </div>
        <div class="action-result" id="summary-result"></div>
      </div>

      <!-- Admin: Cleanup -->
      <div class="card admin-section">
        <div class="admin-section-title">🔧 Admin Tools</div>
        <div class="card-header">
          <h3 class="card-title">🧹 Cleanup & Maintenance</h3>
        </div>
        <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
          Auto-complete past todos and remove past events.
        </p>
        <div class="quick-actions">
          <button class="btn btn-outline" id="cleanup-btn" onclick="runCleanup()">
            🧹 Run Cleanup
          </button>
          <button class="btn btn-outline" onclick="window.location.href='/admin'">
            🔧 Admin Dashboard
          </button>
        </div>
        <div class="action-result" id="cleanup-result"></div>
      </div>

      <!-- Admin: Danger Zone -->
      <div class="card admin-section danger-zone">
        <div class="admin-section-title" style="color: #dc3545;">⚠️ Danger Zone</div>
        <div class="card-header">
          <h3 class="card-title">🗑️ Reset Data</h3>
        </div>
        <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
          Delete all your data for testing. This cannot be undone.
        </p>
        <button class="btn btn-danger" id="reset-btn" onclick="resetAllData()">
          🗑️ Reset All Data
        </button>
        <div class="action-result" id="reset-result"></div>
      </div>
      ` : ''}
    </div>
  `;
}

/**
 * Generate the dashboard JavaScript
 */
export function renderDashboardScripts(userIsAdmin: boolean): string {
  if (!userIsAdmin) {
    return `
      <script>
        // Check onboarding status
        async function checkOnboardingStatus() {
          try {
            const response = await fetch('/onboarding/status');
            if (response.ok) {
              const data = await response.json();
              if (!data.onboarding_completed) {
                document.getElementById('onboarding-card').style.display = 'block';
              }
            }
          } catch (error) {
            console.error('Failed to check onboarding status:', error);
          }
        }
        checkOnboardingStatus();
      </script>
    `;
  }

  return `
    <script>
      // Check onboarding status
      async function checkOnboardingStatus() {
        try {
          const response = await fetch('/onboarding/status');
          if (response.ok) {
            const data = await response.json();
            if (!data.onboarding_completed) {
              document.getElementById('onboarding-card').style.display = 'block';
            }
          }
        } catch (error) {
          console.error('Failed to check onboarding status:', error);
        }
      }
      checkOnboardingStatus();

      function showResult(elementId, message, isSuccess) {
        const el = document.getElementById(elementId);
        el.style.display = 'block';
        el.className = 'action-result ' + (isSuccess ? 'success' : 'error');
        el.innerHTML = message;
      }

      async function syncEvents() {
        const btn = document.getElementById('sync-events-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Syncing...';

        try {
          const response = await fetch('/admin/trigger-event-sync');
          const data = await response.json();

          if (response.ok && data.success) {
            showResult('sync-events-result', '✅ Events synced to Google Calendar!', true);
            setTimeout(() => window.location.reload(), 2000);
          } else {
            throw new Error(data.error || 'Failed to sync');
          }
        } catch (error) {
          showResult('sync-events-result', '❌ ' + error.message, false);
        } finally {
          btn.disabled = false;
          btn.textContent = '🔄 Sync to Calendar';
        }
      }

      async function previewPersonalizedSummary() {
        const btn = document.getElementById('preview-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Loading...';

        try {
          const response = await fetch('/admin/preview-personalized-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });

          if (response.ok) {
            const html = await response.text();
            const blob = new Blob([html], { type: 'text/html' });
            window.open(URL.createObjectURL(blob), '_blank');
            showResult('summary-result', '✅ Preview opened in new tab!', true);
          } else {
            throw new Error('Failed to generate preview');
          }
        } catch (error) {
          showResult('summary-result', '❌ ' + error.message, false);
        } finally {
          btn.disabled = false;
          btn.textContent = '👁️ Preview';
        }
      }

      async function sendDailySummary() {
        const btn = document.getElementById('send-summary-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Sending...';

        try {
          const response = await fetch('/admin/send-daily-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const data = await response.json();

          if (response.ok && data.success) {
            showResult('summary-result', '✅ Summary sent to ' + data.emailsSent + ' recipient(s)!', true);
          } else {
            throw new Error(data.error || data.message || 'Failed to send');
          }
        } catch (error) {
          showResult('summary-result', '❌ ' + error.message, false);
        } finally {
          btn.disabled = false;
          btn.textContent = '📧 Send Summary';
        }
      }

      async function runCleanup() {
        const btn = document.getElementById('cleanup-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Cleaning...';

        try {
          const response = await fetch('/admin/cleanup', { method: 'POST' });
          const data = await response.json();

          if (response.ok && data.success) {
            const msg = '✅ Cleanup complete! ' +
              data.cleanup.todos_auto_completed + ' todos completed, ' +
              data.cleanup.events_removed + ' events removed.';
            showResult('cleanup-result', msg, true);
          } else {
            throw new Error(data.message || 'Cleanup failed');
          }
        } catch (error) {
          showResult('cleanup-result', '❌ ' + error.message, false);
        } finally {
          btn.disabled = false;
          btn.textContent = '🧹 Run Cleanup';
        }
      }

      async function resetAllData() {
        if (!confirm('⚠️ This will delete ALL your data. This cannot be undone. Are you sure?')) {
          return;
        }

        const btn = document.getElementById('reset-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Resetting...';

        try {
          const response = await fetch('/api/reset-all-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const data = await response.json();

          if (response.ok) {
            showResult('reset-result', '✅ All data reset! Reloading...', true);
            setTimeout(() => window.location.reload(), 2000);
          } else {
            throw new Error(data.error || 'Reset failed');
          }
        } catch (error) {
          showResult('reset-result', '❌ ' + error.message, false);
        } finally {
          btn.disabled = false;
          btn.textContent = '🗑️ Reset All Data';
        }
      }
    </script>
  `;
}
