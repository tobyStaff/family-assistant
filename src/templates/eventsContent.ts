// src/templates/eventsContent.ts

interface EventItem {
  id: number;
  title: string;
  date: string | Date;
  end_date?: string | Date;
  description?: string;
  location?: string;
  child_name?: string;
  confidence?: number;
  sync_status: string;
  sync_error?: string;
  retry_count: number;
  google_calendar_event_id?: string;
  source_email_id?: string;
}

interface SourceEmail {
  subject?: string;
  from_email?: string;
  date: string | Date;
  body_text?: string;
  snippet?: string;
}

interface EventStats {
  total: number;
  synced: number;
  pending: number;
  failed: number;
}

export interface EventsContentOptions {
  events: EventItem[];
  stats: EventStats;
  sourceEmails: Map<string, SourceEmail>;
  children: string[];
}

/**
 * Generate the events content HTML (without layout wrapper)
 */
export function renderEventsContent(options: EventsContentOptions): string {
  const { events, stats, sourceEmails, children } = options;

  const eventsHtml = events.length === 0 ? `
    <div class="empty-state">
      <div class="empty-state-icon">📅</div>
      <h2>No events yet</h2>
      <p>Events will appear here after processing emails</p>
    </div>
  ` : events.map(event => {
    // Format dates
    const startDate = new Date(event.date);
    const startDateStr = startDate.toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let endDateStr = '';
    if (event.end_date) {
      const endDate = new Date(event.end_date);
      endDateStr = ` → ${endDate.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    }

    // Source email content
    let sourceEmailHtml = '';
    if (event.source_email_id && sourceEmails.has(event.source_email_id)) {
      const email = sourceEmails.get(event.source_email_id)!;
      const safeSubject = escapeHtml(email.subject || '');
      const safeFrom = escapeHtml(email.from_email || '');
      const safeBody = escapeHtml(email.body_text || email.snippet || '');
      sourceEmailHtml = `
        <div class="source-email-content" id="source-email-${event.id}">
          <div class="source-email-header">📧 ${safeSubject}</div>
          <div class="source-email-meta">
            <strong>From:</strong> ${safeFrom}<br>
            <strong>Date:</strong> ${new Date(email.date).toLocaleString()}
          </div>
          <div class="source-email-body">${safeBody}</div>
        </div>
      `;
    }

    return `
      <div class="event-card" data-status="${event.sync_status}" data-child="${event.child_name || ''}">
        <div class="event-header">
          <div class="event-title">${escapeHtml(event.title)}</div>
          <span class="status-badge status-${event.sync_status}">
            ${event.sync_status === 'synced' ? '✓ Synced' :
              event.sync_status === 'pending' ? '⏳ Pending' : '❌ Failed'}
          </span>
        </div>

        <div class="event-details">
          📅 ${startDateStr}${endDateStr}
        </div>

        ${event.description ? `<div class="event-details">${escapeHtml(event.description)}</div>` : ''}
        ${event.location ? `<div class="event-details">📍 ${escapeHtml(event.location)}</div>` : ''}

        <div class="event-meta">
          ${event.child_name ? `<span>👶 ${escapeHtml(event.child_name)}</span>` : ''}
          ${event.confidence ? `<span>🎯 ${Math.round(event.confidence * 100)}% confidence</span>` : ''}
          ${event.retry_count > 0 ? `<span>🔄 ${event.retry_count} ${event.retry_count === 1 ? 'retry' : 'retries'}</span>` : ''}
          ${event.google_calendar_event_id ? `<span>☁️ Calendar ID: ${event.google_calendar_event_id.substring(0, 12)}...</span>` : ''}
        </div>

        ${event.sync_error ? `<div class="event-error">❌ Error: ${escapeHtml(event.sync_error)}</div>` : ''}

        <div class="event-actions">
          ${event.sync_status === 'failed' || event.sync_status === 'pending' ? `<button class="btn btn-primary" onclick="retrySync(${event.id})">🔄 Retry Sync</button>` : ''}
          <button class="btn btn-danger" onclick="deleteEvent(${event.id})">🗑️ Delete</button>
          ${event.source_email_id && sourceEmails.has(event.source_email_id) ? `
            <button class="btn btn-outline source-email-toggle" onclick="toggleSourceEmail(${event.id})">📧 View Source</button>
          ` : ''}
        </div>
        ${sourceEmailHtml}
      </div>
    `;
  }).join('');

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
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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

      .filters {
        background: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .filter-group {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 12px;
      }

      .filter-group:last-child {
        margin-bottom: 0;
      }

      .filter-label {
        font-weight: 600;
        color: #555;
        min-width: 60px;
      }

      .filter-btn {
        padding: 8px 16px;
        border: 2px solid #e0e0e0;
        background: white;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
      }

      .filter-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .filter-btn.active {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .event-card {
        background: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 15px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .event-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .event-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .event-title {
        font-size: 18px;
        font-weight: 600;
        color: #333;
        flex: 1;
      }

      .status-badge {
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        margin-left: 10px;
      }

      .status-synced {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .status-pending {
        background: #fff3e0;
        color: #e65100;
      }

      .status-failed {
        background: #ffebee;
        color: #c62828;
      }

      .event-details {
        color: #666;
        font-size: 14px;
        margin: 8px 0;
      }

      .event-meta {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        margin-top: 10px;
        font-size: 13px;
        color: #888;
      }

      .event-error {
        margin-top: 10px;
        padding: 10px;
        background: #ffebee;
        color: #c62828;
        border-radius: 6px;
        font-size: 13px;
      }

      .event-actions {
        margin-top: 15px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .source-email-toggle {
        font-size: 12px;
      }

      .source-email-content {
        display: none;
        margin-top: 12px;
        padding: 12px;
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        font-size: 13px;
      }

      .source-email-content.visible {
        display: block;
      }

      .source-email-header {
        font-weight: 600;
        color: #333;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
      }

      .source-email-meta {
        color: #666;
        margin-bottom: 8px;
      }

      .source-email-body {
        white-space: pre-wrap;
        font-family: monospace;
        font-size: 12px;
        max-height: 300px;
        overflow-y: auto;
        background: white;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
      }

      .empty-state {
        background: white;
        padding: 60px 20px;
        border-radius: 12px;
        text-align: center;
        color: #999;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .empty-state-icon {
        font-size: 64px;
        margin-bottom: 20px;
      }
    </style>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${stats.total}</div>
        <div class="stat-label">Total Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.synced}</div>
        <div class="stat-label">Synced</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.pending}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>

    <div class="filters">
      <div class="filter-group">
        <span class="filter-label">Status:</span>
        <button class="filter-btn active" onclick="filterByStatus('all')">All (${stats.total})</button>
        <button class="filter-btn" onclick="filterByStatus('synced')">Synced (${stats.synced})</button>
        <button class="filter-btn" onclick="filterByStatus('pending')">Pending (${stats.pending})</button>
        <button class="filter-btn" onclick="filterByStatus('failed')">Failed (${stats.failed})</button>
      </div>

      ${children.length > 0 ? `
        <div class="filter-group">
          <span class="filter-label">Child:</span>
          <button class="filter-btn active" onclick="filterByChild('all')">All</button>
          ${children.map(child => `<button class="filter-btn" onclick="filterByChild('${escapeHtml(child)}')">${escapeHtml(child)}</button>`).join('')}
        </div>
      ` : ''}
    </div>

    <div id="events-container">
      ${eventsHtml}
    </div>
  `;
}

/**
 * Generate the events JavaScript
 */
export function renderEventsScripts(): string {
  return `
    <script>
      function toggleSourceEmail(eventId) {
        const content = document.getElementById('source-email-' + eventId);
        if (content) {
          content.classList.toggle('visible');
          const btn = event.target;
          btn.textContent = content.classList.contains('visible') ? '📧 Hide Source' : '📧 View Source';
        }
      }

      let currentStatusFilter = 'all';
      let currentChildFilter = 'all';

      function filterByStatus(status) {
        currentStatusFilter = status;
        applyFilters();

        // Update button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
          if (btn.textContent.toLowerCase().startsWith(status)) {
            btn.classList.add('active');
          } else if (status === 'all' && btn.textContent.startsWith('All')) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }

      function filterByChild(child) {
        currentChildFilter = child;
        applyFilters();
      }

      function applyFilters() {
        const cards = document.querySelectorAll('.event-card');

        cards.forEach(card => {
          const matchesStatus = currentStatusFilter === 'all' || card.dataset.status === currentStatusFilter;
          const matchesChild = currentChildFilter === 'all' || card.dataset.child === currentChildFilter;

          if (matchesStatus && matchesChild) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      }

      async function retrySync(eventId) {
        if (!confirm('Retry syncing this event to Google Calendar?')) return;

        try {
          const response = await fetch('/events/' + eventId + '/retry', {
            method: 'POST',
          });

          if (response.ok) {
            alert('Event sync retry initiated! The page will reload.');
            window.location.reload();
          } else {
            const error = await response.json();
            alert('Failed to retry sync: ' + (error.error || 'Unknown error'));
          }
        } catch (error) {
          alert('Failed to retry sync: ' + error.message);
        }
      }

      async function deleteEvent(eventId) {
        if (!confirm('Are you sure you want to delete this event? This cannot be undone.')) return;

        try {
          const response = await fetch('/events/' + eventId, {
            method: 'DELETE',
          });

          if (response.ok) {
            alert('Event deleted successfully!');
            window.location.reload();
          } else {
            const error = await response.json();
            alert('Failed to delete event: ' + (error.error || 'Unknown error'));
          }
        } catch (error) {
          alert('Failed to delete event: ' + error.message);
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
