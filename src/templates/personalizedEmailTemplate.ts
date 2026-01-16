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
 * Render a single todo item
 */
function renderTodo(todo: Todo): string {
  const typeEmoji = getTodoTypeEmoji(todo.type);
  const typeLabel = getTodoTypeLabel(todo.type);
  const dueDate = todo.due_date ? formatDate(todo.due_date) : 'No deadline';
  const amountBadge = todo.amount ? `<span class="amount-badge">${escapeHtml(todo.amount)}</span>` : '';
  const payNowButton = todo.type === 'PAY' && todo.url
    ? `<div style="margin-top: 8px;"><a href="${escapeHtml(todo.url)}" class="pay-button">Pay Now →</a></div>`
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
      ${payNowButton}
    </div>
  `;
}

/**
 * Render a single event
 */
function renderEvent(event: ExtractedEvent): string {
  const eventDate = formatDate(event.date);
  const location = event.location ? `<div class="event-location">📍 ${escapeHtml(event.location)}</div>` : '';

  return `
    <div class="event-item">
      <div class="event-title">${escapeHtml(event.title)}</div>
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
 * Render child summary section
 */
function renderChildSection(child: ChildSummary): string {
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
          ${child.urgent_todos.map(renderTodo).join('')}
          ${child.urgent_events.map(renderEvent).join('')}
        </div>
      ` : ''}

      ${child.upcoming_todos.length > 0 || child.upcoming_events.length > 0 ? `
        <div class="upcoming-section">
          <h3>📆 This Week</h3>
          ${child.upcoming_todos.map(renderTodo).join('')}
          ${child.upcoming_events.map(renderEvent).join('')}
        </div>
      ` : ''}

      ${renderInsights(child.insights)}
    </div>
  `;
}

/**
 * Render family-wide section
 */
function renderFamilySection(family: FamilySummary): string {
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
          ${family.urgent_todos.map(renderTodo).join('')}
          ${family.urgent_events.map(renderEvent).join('')}
        </div>
      ` : ''}

      ${family.upcoming_todos.length > 0 || family.upcoming_events.length > 0 ? `
        <div class="upcoming-section">
          <h3>📆 This Week</h3>
          ${family.upcoming_todos.map(renderTodo).join('')}
          ${family.upcoming_events.map(renderEvent).join('')}
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📬 Your Family Briefing</h1>
      <div class="date">${dateStr}</div>
    </div>

    ${summary.insights.length > 0 ? `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
        <h3 style="margin: 0 0 10px 0; color: white;">✨ Today's Overview</h3>
        ${summary.insights.map(insight => `<div style="margin: 6px 0;">• ${escapeHtml(insight)}</div>`).join('')}
      </div>
    ` : ''}

    ${summary.by_child.map(renderChildSection).join('')}

    ${renderFamilySection(summary.family_wide)}

    <div class="footer">
      Generated by Inbox Manager • ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>
  `;
}
