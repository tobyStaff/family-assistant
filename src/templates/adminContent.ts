// src/templates/adminContent.ts
import type { Role } from '../types/roles.js';

interface UserWithRoles {
  user_id: string;
  email: string;
  name?: string;
  roles: Role[];
}

export interface AdminContentOptions {
  userEmail: string;
  userRoles: Role[];
  isSuperAdmin: boolean;
  impersonatedUser: { email: string } | null;
  allUsers: UserWithRoles[];
  impersonatingUserId: string | null;
}

/**
 * Generate the admin dashboard content HTML (without layout wrapper)
 */
export function renderAdminContent(options: AdminContentOptions): string {
  const { userEmail, userRoles, isSuperAdmin, impersonatedUser, allUsers, impersonatingUserId } = options;

  return `
    <style>
      .admin-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
        gap: 20px;
      }

      .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 15px;
      }

      .tool-link {
        display: block;
        padding: 20px;
        background: var(--bg-muted);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        text-decoration: none;
        transition: all 0.2s;
        border: 1px solid var(--border-light);
      }

      .tool-link:hover {
        background: var(--sky);
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: var(--primary-color);
      }

      .tool-link h3 {
        font-family: var(--font-display);
        font-size: 16px;
        margin-bottom: 8px;
        color: var(--text-primary);
      }

      .tool-link p {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0;
      }

      .user-select {
        width: 100%;
        padding: 12px 14px;
        border-radius: var(--radius-md);
        border: 2px solid var(--border-light);
        background: var(--bg-card);
        font-size: 14px;
        font-family: var(--font-body);
        margin-bottom: 15px;
        transition: border-color 0.2s;
      }

      .user-select:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .user-list {
        max-height: 400px;
        overflow-y: auto;
      }

      .user-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        background: var(--bg-muted);
        border-radius: var(--radius-sm);
        margin-bottom: 8px;
      }

      .user-item:last-child {
        margin-bottom: 0;
      }

      .user-email {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .user-roles {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
      }

      .role-badge-small {
        display: inline-block;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: 10px;
        font-weight: 600;
        margin-left: 4px;
      }

      .role-super { background: var(--danger-color); color: white; }
      .role-admin { background: var(--warning-light); color: #92400E; }
      .role-standard { background: var(--text-muted); color: white; }

      .impersonate-info {
        background: var(--warning-light);
        border: 1px solid #FCD34D;
        color: #92400E;
        padding: 14px;
        border-radius: var(--radius-md);
        margin-bottom: 15px;
        font-size: 14px;
        font-weight: 500;
      }

      .section-description {
        color: var(--text-secondary);
        font-size: 14px;
        margin-bottom: 15px;
      }
    </style>

    <div class="admin-grid">
      <!-- Admin Tools -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🔧 Admin Tools</h3>
        </div>
        <div class="tools-grid">
          <a href="#" class="tool-link" onclick="event.preventDefault(); submitPost('/admin/preview-personalized-summary')">
            <h3>👁️ Preview Summary</h3>
            <p>Preview the personalized daily summary email</p>
          </a>
          <a href="/admin/inbox-stats" class="tool-link">
            <h3>📊 Inbox Stats</h3>
            <p>View inbox statistics and email counts</p>
          </a>
          <a href="/admin/check-scopes" class="tool-link">
            <h3>🔑 Check OAuth Scopes</h3>
            <p>Verify current OAuth token permissions</p>
          </a>
          <a href="/emails-view" class="tool-link">
            <h3>📧 Stored Emails</h3>
            <p>View and manage stored emails</p>
          </a>
          <a href="/analyses-view" class="tool-link">
            <h3>🔍 Email Analyses</h3>
            <p>View AI analysis results</p>
          </a>
          <a href="/metrics/dashboard" class="tool-link">
            <h3>📈 AI Metrics</h3>
            <p>View AI performance metrics</p>
          </a>
        </div>
      </div>

      ${isSuperAdmin ? `
      <!-- User Impersonation -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">👁️ User Impersonation</h3>
        </div>
        <p class="section-description">
          View the app as another user to debug issues. This does not affect the user's data.
        </p>
        ${impersonatedUser ? `
          <div class="impersonate-info">
            Currently viewing as: <strong>${impersonatedUser.email}</strong>
          </div>
        ` : ''}
        <form action="/admin/impersonate" method="POST">
          <select name="targetUserId" class="user-select" required>
            <option value="">Select a user to impersonate...</option>
            ${allUsers.map(u => `
              <option value="${u.user_id}" ${u.user_id === impersonatingUserId ? 'selected' : ''}>
                ${u.email} (${u.roles.join(', ')})
              </option>
            `).join('')}
          </select>
          <div style="display: flex; gap: 10px;">
            <button type="submit" class="btn btn-primary">Start Impersonation</button>
            ${impersonatedUser ? `
              <form action="/admin/stop-impersonation" method="POST" style="display: inline;">
                <button type="submit" class="btn btn-danger">Stop Impersonating</button>
              </form>
            ` : ''}
          </div>
        </form>
      </div>

      <!-- All Users -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">👥 All Users (${allUsers.length})</h3>
        </div>
        <div class="user-list">
          ${allUsers.map(u => `
            <div class="user-item">
              <div>
                <div class="user-email">${u.email}</div>
                <div class="user-roles">
                  ${u.roles.map(role => `
                    <span class="role-badge-small role-${role.toLowerCase()}">${role}</span>
                  `).join('')}
                </div>
              </div>
              <button class="btn btn-danger btn-sm" onclick="resetUser('${u.user_id}', '${u.email}')" style="font-size: 12px; padding: 4px 10px;">Reset</button>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

/**
 * Generate the admin dashboard JavaScript
 */
export function renderAdminScripts(): string {
  return `
    <script>
      function submitPost(url) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        document.body.appendChild(form);
        form.submit();
      }

      async function resetUser(userId, email) {
        if (!confirm('Reset all data for ' + email + '? This will delete all emails, todos, events, analyses, child profiles, and OAuth tokens. The user will need to re-onboard.')) {
          return;
        }
        if (!confirm('Are you sure? This cannot be undone.')) {
          return;
        }
        try {
          const res = await fetch('/admin/reset-user/' + userId, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            alert(data.message);
            location.reload();
          } else {
            alert('Error: ' + (data.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Failed: ' + err.message);
        }
      }
    </script>
  `;
}
