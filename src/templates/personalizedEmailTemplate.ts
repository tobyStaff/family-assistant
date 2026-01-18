// src/templates/personalizedEmailTemplate.ts

import type { PersonalizedSummary, ChildSummary, FamilySummary } from '../utils/personalizedSummaryBuilder.js';
import type { Todo } from '../types/todo.js';
import type { ExtractedEvent, TodoType } from '../types/extraction.js';
import { getTodoTypeLabel, getTodoTypeEmoji } from '../types/extraction.js';

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return map[m];
  });
}

/**
 * Format date in friendly way
 */
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Check if same day
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (d.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/**
 * Get action button label based on todo type
 */
function getActionButtonLabel(type: TodoType): string {
  switch (type) {
    case 'PAY': return 'Pay Now →';
    case 'SIGN': return 'Sign Form →';
    case 'FILL': return 'Fill Form →';
    case 'READ': return 'Read Now →';
    case 'BUY': return 'Buy Now →';
    default: return 'Open Link →';
  }
}

/**
 * Render a single todo item
 * @param todo - The todo item
 * @param baseUrl - Base URL for action buttons (optional)
 */
function renderTodo(todo: Todo, baseUrl?: string): string {
  const typeEmoji = getTodoTypeEmoji(todo.type);
  const typeLabel = getTodoTypeLabel(todo.type);
  const dueDate = todo.due_date ? formatDate(todo.due_date) : 'No deadline';
  const amountBadge = todo.amount ? `<span class="amount-badge">${escapeHtml(todo.amount)}</span>` : '';

  // Action button for URL (with correct label based on type)
  const actionButton = todo.url
    ? `<a href="${escapeHtml(todo.url)}" class="action-button">${getActionButtonLabel(todo.type)}</a>`
    : '';

  // Mark complete button (if baseUrl provided)
  const completeButton = baseUrl && todo.id
    ? `<a href="${baseUrl}/api/todos/${todo.id}/complete-from-email" class="complete-button">✓ Done</a>`
    : '';

  return `
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">${typeEmoji} ${typeLabel}</span>
        ${amountBadge}
      </div>
      <div class="todo-description">${escapeHtml(todo.description)}</div>
      <div class="todo-meta">
        <span>⏰ ${dueDate}</span>
        ${todo.child_name && todo.child_name !== 'General' ? `<span>👶 ${escapeHtml(todo.child_name)}</span>` : ''}
      </div>
      ${(actionButton || completeButton) ? `
        <div class="todo-actions">
          ${actionButton}
          ${completeButton}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Extended event type with database id
 */
interface EventWithId extends ExtractedEvent {
  id?: number;
}

/**
 * Render a single event
 * @param event - The event
 * @param baseUrl - Base URL for action buttons (optional)
 */
function renderEvent(event: EventWithId, baseUrl?: string): string {
  const eventDate = formatDate(event.date);
  const location = event.location ? `<div class="event-location">📍 ${escapeHtml(event.location)}</div>` : '';

  // Remove button (if baseUrl provided)
  const removeButton = baseUrl && event.id
    ? `<a href="${baseUrl}/api/events/${event.id}/remove-from-email" class="remove-button">✕ Remove</a>`
    : '';

  return `
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">${escapeHtml(event.title)}</div>
        ${removeButton}
      </div>
      <div class="event-date">📅 ${eventDate}</div>
      ${location}
      ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
    </div>
  `;
}

/**
 * Render insights section
 */
function renderInsights(insights: string[]): string {
  if (insights.length === 0) return '';

  return `
    <div class="insights-section">
      <h3>💡 Insights</h3>
      ${insights.map(insight => `<div class="insight-item">• ${escapeHtml(insight)}</div>`).join('')}
    </div>
  `;
}

/**
 * Render items grouped by child within a section
 */
function renderChildGroup(
  childName: string,
  displayName: string | undefined,
  todos: Todo[],
  events: EventWithId[],
  baseUrl?: string
): string {
  if (todos.length === 0 && events.length === 0) return '';

  const name = displayName || childName;

  return `
    <div class="child-group">
      <h4>👶 ${escapeHtml(name)}</h4>
      ${todos.map(t => renderTodo(t, baseUrl)).join('')}
      ${events.map(e => renderEvent(e, baseUrl)).join('')}
    </div>
  `;
}

/**
 * Render the Essential section (urgent items - today/tomorrow)
 */
function renderEssentialSection(
  summary: PersonalizedSummary,
  baseUrl?: string
): string {
  // Collect all urgent items
  const hasChildUrgent = summary.by_child.some(c =>
    c.urgent_todos.length > 0 || c.urgent_events.length > 0
  );
  const hasFamilyUrgent = summary.family_wide.urgent_todos.length > 0 ||
    summary.family_wide.urgent_events.length > 0;

  if (!hasChildUrgent && !hasFamilyUrgent) {
    return `
      <div class="essential-section">
        <h2>🔥 Essential</h2>
        <div class="empty-state">✓ Nothing urgent - you're all caught up!</div>
      </div>
    `;
  }

  return `
    <div class="essential-section">
      <h2>🔥 Essential</h2>
      <p class="section-subtitle">Happening soon or requires immediate action</p>

      ${summary.by_child.map(child => renderChildGroup(
        child.child_name,
        child.display_name,
        child.urgent_todos,
        child.urgent_events as EventWithId[],
        baseUrl
      )).join('')}

      ${hasFamilyUrgent ? `
        <div class="child-group">
          <h4>🏠 Family-Wide</h4>
          ${summary.family_wide.urgent_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${summary.family_wide.urgent_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render the For Consideration section (upcoming items - rest of week)
 */
function renderForConsiderationSection(
  summary: PersonalizedSummary,
  baseUrl?: string
): string {
  // Collect all upcoming items
  const hasChildUpcoming = summary.by_child.some(c =>
    c.upcoming_todos.length > 0 || c.upcoming_events.length > 0
  );
  const hasFamilyUpcoming = summary.family_wide.upcoming_todos.length > 0 ||
    summary.family_wide.upcoming_events.length > 0;

  if (!hasChildUpcoming && !hasFamilyUpcoming) {
    return '';
  }

  return `
    <div class="consideration-section">
      <h2>📋 For Consideration</h2>
      <p class="section-subtitle">Coming up this week - plan ahead</p>

      ${summary.by_child.map(child => renderChildGroup(
        child.child_name,
        child.display_name,
        child.upcoming_todos,
        child.upcoming_events as EventWithId[],
        baseUrl
      )).join('')}

      ${hasFamilyUpcoming ? `
        <div class="child-group">
          <h4>🏠 Family-Wide</h4>
          ${summary.family_wide.upcoming_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${summary.family_wide.upcoming_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render all insights section
 */
function renderAllInsights(summary: PersonalizedSummary): string {
  const allInsights: string[] = [
    ...summary.insights,
    ...summary.by_child.flatMap(c => c.insights),
  ];

  if (allInsights.length === 0) return '';

  return `
    <div class="insights-section">
      <h3>💡 Insights</h3>
      ${allInsights.map(insight => `<div class="insight-item">• ${escapeHtml(insight)}</div>`).join('')}
    </div>
  `;
}

// Keep legacy functions for backward compatibility
/**
 * Render child summary section (legacy - kept for compatibility)
 */
function renderChildSection(child: ChildSummary, baseUrl?: string): string {
  const displayName = child.display_name || child.child_name;
  const hasUrgent = child.urgent_todos.length > 0 || child.urgent_events.length > 0;
  const hasUpcoming = child.upcoming_todos.length > 0 || child.upcoming_events.length > 0;

  if (!hasUrgent && !hasUpcoming && child.insights.length === 0) {
    return `
      <div class="child-section">
        <h2>👶 ${escapeHtml(displayName)}</h2>
        <div class="empty-state">✓ All clear - no upcoming items</div>
      </div>
    `;
  }

  return `
    <div class="child-section">
      <h2>👶 ${escapeHtml(displayName)}</h2>

      ${child.urgent_todos.length > 0 || child.urgent_events.length > 0 ? `
        <div class="urgent-section">
          <h3>🔥 Urgent (Today/Tomorrow)</h3>
          ${child.urgent_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${child.urgent_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}

      ${child.upcoming_todos.length > 0 || child.upcoming_events.length > 0 ? `
        <div class="upcoming-section">
          <h3>📆 This Week</h3>
          ${child.upcoming_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${child.upcoming_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}

      ${renderInsights(child.insights)}
    </div>
  `;
}

/**
 * Render family-wide section (legacy - kept for compatibility)
 */
function renderFamilySection(family: FamilySummary, baseUrl?: string): string {
  const hasItems = family.urgent_todos.length > 0 || family.urgent_events.length > 0
    || family.upcoming_todos.length > 0 || family.upcoming_events.length > 0;

  if (!hasItems && family.insights.length === 0) {
    return '';
  }

  return `
    <div class="family-section">
      <h2>🏠 Family-Wide</h2>

      ${family.urgent_todos.length > 0 || family.urgent_events.length > 0 ? `
        <div class="urgent-section">
          <h3>🔥 Urgent (Today/Tomorrow)</h3>
          ${family.urgent_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${family.urgent_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}

      ${family.upcoming_todos.length > 0 || family.upcoming_events.length > 0 ? `
        <div class="upcoming-section">
          <h3>📆 This Week</h3>
          ${family.upcoming_todos.map(t => renderTodo(t, baseUrl)).join('')}
          ${family.upcoming_events.map(e => renderEvent(e as EventWithId, baseUrl)).join('')}
        </div>
      ` : ''}

      ${renderInsights(family.insights)}
    </div>
  `;
}

/**
 * Render complete personalized email
 */
export function renderPersonalizedEmail(summary: PersonalizedSummary): string {
  const dateStr = summary.generated_at.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Personalized Family Briefing</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 650px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
      padding: 35px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #667eea;
    }
    h1 {
      margin: 0;
      color: #1a1a1a;
      font-size: 28px;
      margin-bottom: 8px;
    }
    .date {
      color: #666;
      font-size: 14px;
    }
    h2 {
      color: #1a1a1a;
      font-size: 22px;
      margin: 30px 0 15px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #e0e0e0;
    }
    h3 {
      color: #555;
      font-size: 16px;
      margin: 20px 0 12px 0;
      font-weight: 600;
    }
    .child-section, .family-section {
      margin-bottom: 35px;
    }
    .urgent-section {
      background: #fff3cd;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #ffc107;
      margin-bottom: 20px;
    }
    .upcoming-section {
      margin-bottom: 20px;
    }
    .todo-item {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid #667eea;
    }
    .todo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .todo-type {
      font-weight: 600;
      color: #667eea;
      font-size: 14px;
    }
    .amount-badge {
      background: #dc3545;
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
    }
    .todo-description {
      font-size: 15px;
      margin-bottom: 8px;
      line-height: 1.5;
    }
    .todo-meta {
      font-size: 13px;
      color: #666;
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
    }
    .pay-button {
      display: inline-block;
      background: #28a745;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    .pay-button:hover {
      background: #218838;
    }
    .event-item {
      background: #e3f2fd;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid #2196f3;
    }
    .event-title {
      font-weight: 600;
      font-size: 15px;
      margin-bottom: 6px;
      color: #1976d2;
    }
    .event-date {
      font-size: 13px;
      color: #666;
      margin-bottom: 4px;
    }
    .event-location {
      font-size: 13px;
      color: #666;
      margin-bottom: 4px;
    }
    .event-description {
      font-size: 14px;
      color: #555;
      margin-top: 8px;
      line-height: 1.4;
    }
    .insights-section {
      background: #f0f4ff;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
      margin-top: 15px;
    }
    .insight-item {
      color: #555;
      margin: 6px 0;
      line-height: 1.5;
    }
    .empty-state {
      color: #999;
      font-style: italic;
      padding: 20px;
      text-align: center;
      background: #f8f9fa;
      border-radius: 6px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 13px;
    }
    /* New section styles */
    .essential-section {
      background: #fff8e1;
      padding: 20px;
      border-radius: 12px;
      border: 2px solid #ffc107;
      margin-bottom: 25px;
    }
    .essential-section h2 {
      color: #e65100;
      margin-top: 0;
      border-bottom-color: #ffc107;
    }
    .consideration-section {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #e0e0e0;
      margin-bottom: 25px;
    }
    .consideration-section h2 {
      color: #555;
      margin-top: 0;
    }
    .section-subtitle {
      color: #666;
      font-size: 14px;
      margin: -10px 0 15px 0;
    }
    .child-group {
      margin-bottom: 20px;
      padding-left: 10px;
      border-left: 3px solid #667eea;
    }
    .child-group h4 {
      color: #667eea;
      margin: 0 0 12px 0;
      font-size: 15px;
    }
    .todo-actions, .event-header {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .event-header {
      justify-content: space-between;
      margin-top: 0;
      margin-bottom: 6px;
    }
    .action-button {
      display: inline-block;
      background: #28a745;
      color: white;
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .action-button:hover {
      background: #218838;
    }
    .complete-button {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .complete-button:hover {
      background: #5a6fd6;
    }
    .remove-button {
      display: inline-block;
      background: #dc3545;
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      text-decoration: none;
      font-weight: 500;
      font-size: 12px;
    }
    .remove-button:hover {
      background: #c82333;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📬 Your Family Briefing</h1>
      <div class="date">${dateStr}</div>
    </div>

    ${renderAllInsights(summary)}

    ${renderEssentialSection(summary)}

    ${renderForConsiderationSection(summary)}

    <div class="footer">
      Generated by Inbox Manager • ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>
  `;
}
