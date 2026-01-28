// src/templates/emailsViewContent.ts

interface StoredEmail {
  id: number;
  gmail_message_id: string;
  subject: string;
  from_email: string;
  from_name?: string;
  date: Date;
  snippet?: string;
  body_text?: string;
  labels?: string[];
  has_attachments: boolean;
  attachment_extraction_failed: boolean;
  processed: boolean;
  analyzed: boolean;
  gmail_labeled: boolean;
  fetch_error?: string;
}

interface EmailStats {
  total: number;
  processed: number;
  analyzed: number;
}

export interface EmailsViewContentOptions {
  emails: StoredEmail[];
  stats: EmailStats;
}

/**
 * Generate the emails view content HTML (without layout wrapper)
 */
export function renderEmailsViewContent(options: EmailsViewContentOptions): string {
  const { emails, stats } = options;

  const emailsHtml = emails.length > 0
    ? emails.map((email) => `
        <div class="email-card" data-email-id="${email.id}">
          <div class="email-header">
            <div class="email-subject">${escapeHtml(email.subject)}</div>
            <div class="email-badges">
              ${email.processed ? '<span class="badge badge-success">Processed</span>' : '<span class="badge badge-warning">Pending</span>'}
              ${email.analyzed ? '<span class="badge badge-info">Analyzed</span>' : ''}
              ${email.gmail_labeled ? '<span class="badge badge-secondary">Gmail Labeled</span>' : ''}
              ${email.has_attachments ? '<span class="badge badge-attachment">📎 Attachment</span>' : ''}
              ${email.attachment_extraction_failed ? '<span class="badge badge-error">⚠️ Extraction Failed</span>' : ''}
            </div>
          </div>
          <div class="email-meta">
            <span class="email-from">From: ${escapeHtml(email.from_name || email.from_email)}</span>
            <span class="email-date">${formatDate(email.date)}</span>
          </div>
          ${email.labels && email.labels.length > 0 ? `
            <div class="email-labels">
              ${email.labels.map(label => `<span class="label-tag">${escapeHtml(label)}</span>`).join('')}
            </div>
          ` : ''}
          <div class="email-snippet">${escapeHtml(email.snippet || '')}</div>
          <details class="email-body-details">
            <summary>View Full Body</summary>
            <div class="email-body">${escapeHtml(email.body_text || '(No body content)')}</div>
          </details>
          ${email.fetch_error ? `<div class="email-error">Error: ${escapeHtml(email.fetch_error)}</div>` : ''}
          <div class="email-actions">
            ${email.attachment_extraction_failed ? `<button class="btn btn-warning btn-sm" data-email-id="${email.id}" onclick="retryAttachments(this)">🔄 Retry Extraction</button>` : ''}
            <button class="btn btn-danger btn-sm" data-email-id="${email.id}" onclick="deleteEmail(this)">🗑️ Delete</button>
          </div>
        </div>
      `).join('')
    : '<div class="empty-state">No emails stored yet. Click "Fetch Emails from Gmail" to import emails.</div>';

  return `
    <style>
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 15px;
        margin-bottom: 24px;
      }

      .stat-card {
        background: linear-gradient(135deg, var(--primary-color) 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 12px;
        text-align: center;
      }

      .stat-number {
        font-size: 32px;
        font-weight: bold;
        margin-bottom: 5px;
      }

      .stat-label {
        font-size: 14px;
        opacity: 0.9;
      }

      .fetch-controls {
        background: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .fetch-options {
        display: flex;
        gap: 15px;
        align-items: center;
        margin-bottom: 15px;
        flex-wrap: wrap;
      }

      .fetch-options label {
        font-size: 14px;
        color: #666;
      }

      .fetch-options select,
      .fetch-options input {
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }

      .fetch-actions {
        display: flex;
        gap: 10px;
      }

      .email-card {
        background: white;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 15px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .email-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .email-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 15px;
        margin-bottom: 10px;
      }

      .email-subject {
        font-weight: 600;
        color: #333;
        font-size: 16px;
        flex: 1;
      }

      .email-badges {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }

      .badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }

      .badge-success { background: #d4edda; color: #155724; }
      .badge-warning { background: #fff3cd; color: #856404; }
      .badge-info { background: #d1ecf1; color: #0c5460; }
      .badge-secondary { background: #e2e3e5; color: #383d41; }
      .badge-attachment { background: #e3f2fd; color: #1565c0; }
      .badge-error { background: #f8d7da; color: #721c24; }

      .btn-warning {
        background: #ffc107;
        color: #212529;
        border: none;
      }
      .btn-warning:hover {
        background: #e0a800;
      }

      .email-meta {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: #666;
        margin-bottom: 10px;
      }

      .email-labels {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }

      .label-tag {
        background: #e3f2fd;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        color: #1565c0;
      }

      .email-snippet {
        font-size: 14px;
        color: #555;
        line-height: 1.5;
        margin-bottom: 10px;
      }

      .email-body-details {
        margin-top: 10px;
      }

      .email-body-details summary {
        cursor: pointer;
        color: var(--primary-color);
        font-size: 13px;
        font-weight: 500;
      }

      .email-body {
        margin-top: 10px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 6px;
        font-size: 13px;
        white-space: pre-wrap;
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid #e0e0e0;
      }

      .email-error {
        margin-top: 10px;
        padding: 10px;
        background: #f8d7da;
        color: #721c24;
        border-radius: 6px;
        font-size: 13px;
      }

      .email-actions {
        margin-top: 12px;
        display: flex;
        gap: 8px;
      }

      .btn-sm {
        padding: 6px 12px;
        font-size: 12px;
      }

      .empty-state {
        background: white;
        padding: 60px 20px;
        border-radius: 12px;
        text-align: center;
        color: #666;
        font-style: italic;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      #fetch-result {
        margin-top: 15px;
        padding: 15px;
        border-radius: 8px;
        display: none;
      }

      .result-success { background: #d4edda; color: #155724; }
      .result-error { background: #f8d7da; color: #721c24; }
    </style>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${stats.total}</div>
        <div class="stat-label">Total Emails</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.processed}</div>
        <div class="stat-label">Processed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.analyzed}</div>
        <div class="stat-label">Analyzed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.total - stats.analyzed}</div>
        <div class="stat-label">Pending Analysis</div>
      </div>
    </div>

    <div class="fetch-controls">
      <div class="fetch-options">
        <label>
          Date Range:
          <select id="date-range">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last3days" selected>Last 3 Days</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
          </select>
        </label>
        <label>
          Max Emails:
          <input type="number" id="max-results" value="100" min="1" max="500" style="width: 80px;">
        </label>
      </div>
      <div class="fetch-actions">
        <button class="btn btn-primary" id="fetch-btn" onclick="fetchEmails()">
          📥 Fetch Emails from Gmail
        </button>
        <button class="btn btn-outline" onclick="window.location.reload()">
          🔄 Refresh Page
        </button>
      </div>
      <div id="fetch-result"></div>
    </div>

    <h3 style="margin-bottom: 15px;">Emails (${emails.length})</h3>
    <div id="emails-container">
      ${emailsHtml}
    </div>
  `;
}

/**
 * Generate the emails view JavaScript
 */
export function renderEmailsViewScripts(): string {
  return `
    <script>
      async function fetchEmails() {
        const btn = document.getElementById('fetch-btn');
        const resultDiv = document.getElementById('fetch-result');
        const dateRange = document.getElementById('date-range').value;
        const maxResults = parseInt(document.getElementById('max-results').value);

        btn.disabled = true;
        btn.textContent = '⏳ Fetching...';
        resultDiv.style.display = 'none';

        try {
          const response = await fetch('/api/emails/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateRange, maxResults })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            resultDiv.className = 'result-success';
            resultDiv.innerHTML = \`
              <strong>✅ Email fetch complete!</strong><br>
              Fetched: \${data.fetched} | Stored: \${data.stored} | Skipped: \${data.skipped} | Errors: \${data.errors}<br>
              Gmail labels synced: \${data.labelSync?.labeled || 0}
              \${data.errorMessages && data.errorMessages.length > 0 ? '<br><small>Errors: ' + data.errorMessages.join(', ') + '</small>' : ''}
            \`;
            setTimeout(() => window.location.reload(), 2000);
          } else {
            throw new Error(data.message || data.error || 'Fetch failed');
          }
        } catch (error) {
          resultDiv.className = 'result-error';
          resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
        } finally {
          resultDiv.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '📥 Fetch Emails from Gmail';
        }
      }

      async function retryAttachments(btn) {
        const emailId = btn.dataset.emailId;
        const card = btn.closest('.email-card');
        const subject = card.querySelector('.email-subject')?.textContent || 'this email';

        btn.disabled = true;
        btn.textContent = '⏳ Retrying...';

        try {
          const response = await fetch('/admin/emails/' + emailId + '/retry-attachments', {
            method: 'POST'
          });

          const data = await response.json();

          if (response.ok && data.success) {
            if (data.succeeded > 0) {
              alert('✅ Retry successful! ' + data.succeeded + ' of ' + data.retried + ' attachments extracted.');
              // Remove the error badge and retry button if all succeeded
              if (data.succeeded === data.retried) {
                const errorBadge = card.querySelector('.badge-error');
                if (errorBadge) errorBadge.remove();
                btn.remove();
              } else {
                btn.textContent = '🔄 Retry Extraction';
                btn.disabled = false;
              }
            } else {
              alert('❌ Retry failed. No attachments could be extracted.');
              btn.textContent = '🔄 Retry Extraction';
              btn.disabled = false;
            }
          } else {
            throw new Error(data.error || data.message || 'Retry failed');
          }
        } catch (error) {
          alert('Error retrying extraction: ' + error.message);
          btn.disabled = false;
          btn.textContent = '🔄 Retry Extraction';
        }
      }

      async function deleteEmail(btn) {
        const emailId = btn.dataset.emailId;
        const card = btn.closest('.email-card');
        const subject = card.querySelector('.email-subject')?.textContent || 'this email';

        if (!confirm('Delete "' + subject + '"?\\n\\nThis will also delete any associated analysis.')) {
          return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Deleting...';

        try {
          const response = await fetch('/api/emails/' + emailId, {
            method: 'DELETE'
          });

          if (response.ok) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-20px)';
            setTimeout(() => card.remove(), 300);
          } else {
            const data = await response.json();
            throw new Error(data.error || 'Delete failed');
          }
        } catch (error) {
          alert('Error deleting email: ' + error.message);
          btn.disabled = false;
          btn.textContent = '🗑️ Delete';
        }
      }
    </script>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
