// src/templates/personalizedEmailTemplate.ts

import type { PersonalizedSummary, ChildSummary, FamilySummary } from '../utils/personalizedSummaryBuilder.js';
import type { Todo } from '../types/todo.js';
import type { ExtractedEvent, TodoType } from '../types/extraction.js';
import { getTodoTypeLabel, getTodoTypeEmoji } from '../types/extraction.js';
import { getPaymentButtonInfo, extractPaymentProvider } from '../utils/paymentProviders.js';

/**
 * Child summary with action URLs for todos and events
 */
export interface ChildSummaryWithActions {
  child_name: string;
  display_name?: string;
  today_todos: TodoWithAction[];
  today_events: EventWithAction[];
  upcoming_todos: TodoWithAction[];
  upcoming_events: EventWithAction[];
  insights: string[];
}

/**
 * Family summary with action URLs
 */
export interface FamilySummaryWithActions {
  today_todos: TodoWithAction[];
  today_events: EventWithAction[];
  upcoming_todos: TodoWithAction[];
  upcoming_events: EventWithAction[];
  insights: string[];
}

/**
 * Personalized summary with action URLs for email rendering
 */
export interface PersonalizedSummaryWithActions {
  generated_at: Date;
  date_range: { start: Date; end: Date };
  by_child: ChildSummaryWithActions[];
  family_wide: FamilySummaryWithActions;
  insights: string[];
}

/**
 * Todo with action URL for email buttons
 */
export interface TodoWithAction extends Todo {
  actionUrl?: string;
}

/**
 * Event with action URL for email buttons
 */
export interface EventWithAction extends ExtractedEvent {
  id?: number;
  actionUrl?: string;
}

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
 * @param todo - The todo item (with optional actionUrl)
 */
function renderTodo(todo: TodoWithAction): string {
  const typeEmoji = getTodoTypeEmoji(todo.type);
  const typeLabel = getTodoTypeLabel(todo.type);
  const dueDate = todo.due_date ? formatDate(todo.due_date) : null;
  const amountBadge = todo.amount ? `<span class="amount-badge">${escapeHtml(todo.amount)}</span>` : '';

  // Action button for URL (with correct label based on type)
  let actionButton = '';
  const paymentBtn = getPaymentButtonInfo(todo);
  if (paymentBtn) {
    actionButton = `<a href="${escapeHtml(paymentBtn.url)}" class="action-button">${escapeHtml(paymentBtn.label)}</a>`;
  } else if (todo.type === 'PAY') {
    // For PAY types without a known provider, show info badge if provider mentioned
    const provider = extractPaymentProvider(todo.description);
    if (provider?.name) {
      actionButton = `<span class="payment-provider-badge">💳 Pay via ${escapeHtml(provider.name)}</span>`;
    }
  }

  // Mark complete button (if actionUrl provided - token-based)
  const completeButton = todo.actionUrl
    ? `<a href="${escapeHtml(todo.actionUrl)}" class="complete-button">✓ Done</a>`
    : '';

  // Build meta items
  const metaItems: string[] = [];
  if (dueDate) metaItems.push(`<span>⏰ ${dueDate}</span>`);
  if (todo.child_name && todo.child_name !== 'General') {
    metaItems.push(`<span class="child-badge">👶 ${escapeHtml(todo.child_name)}</span>`);
  }

  return `
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">${typeEmoji} ${typeLabel}</span>
        ${amountBadge}
      </div>
      <div class="todo-description">${escapeHtml(todo.description)}</div>
      ${metaItems.length > 0 ? `<div class="todo-meta">${metaItems.join('')}</div>` : ''}
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
 * Render a single event
 * @param event - The event (with optional actionUrl)
 */
function renderEvent(event: EventWithAction): string {
  const eventDate = formatDate(event.date);
  const location = event.location ? `<div class="event-location">📍 ${escapeHtml(event.location)}</div>` : '';
  const childBadge = event.child_name && event.child_name !== 'General'
    ? `<span class="child-badge">👶 ${escapeHtml(event.child_name)}</span>`
    : '';

  // Remove button (if actionUrl provided - token-based)
  const removeButton = event.actionUrl
    ? `<a href="${escapeHtml(event.actionUrl)}" class="remove-button">✕ Remove</a>`
    : '';

  return `
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">${escapeHtml(event.title)}</div>
        ${removeButton}
      </div>
      <div class="event-meta">
        <span class="event-date">📅 ${eventDate}</span>
        ${childBadge}
      </div>
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
 * Render items as a flat list (no child grouping wrapper)
 */
function renderItemsFlat(
  todos: TodoWithAction[],
  events: EventWithAction[]
): string {
  return `
    ${todos.map(t => renderTodo(t)).join('')}
    ${events.map(e => renderEvent(e)).join('')}
  `;
}

/**
 * Get a short one-line summary of a todo for bullet points
 */
function getTodoBulletText(todo: TodoWithAction): string {
  const emoji = getTodoTypeEmoji(todo.type);
  const childPrefix = todo.child_name && todo.child_name !== 'General' ? `[${todo.child_name}] ` : '';
  const amount = todo.amount ? ` (${todo.amount})` : '';
  return `${emoji} ${childPrefix}${todo.description}${amount}`;
}

/**
 * Get a short one-line summary of an event for bullet points
 */
function getEventBulletText(event: EventWithAction): string {
  const childPrefix = event.child_name && event.child_name !== 'General' ? `[${event.child_name}] ` : '';
  const time = new Date(event.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `📅 ${childPrefix}${event.title} at ${time}`;
}

/**
 * Render the Summary of Today section (bullet points)
 */
function renderTodaySummary(
  summary: PersonalizedSummaryWithActions
): string {
  // Collect all today items
  const allTodayTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_todos),
    ...summary.family_wide.today_todos,
  ];
  const allTodayEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_events as EventWithAction[]),
    ...(summary.family_wide.today_events as EventWithAction[]),
  ];

  if (allTodayTodos.length === 0 && allTodayEvents.length === 0) {
    return `
      <div class="section summary-section">
        <div class="section-header today-summary">
          <span class="section-icon">☀️</span>
          <span class="section-title">Summary of Today</span>
        </div>
        <div class="empty-state">✓ Nothing scheduled for today - enjoy your day!</div>
      </div>
    `;
  }

  const bullets = [
    ...allTodayTodos.map(t => getTodoBulletText(t)),
    ...allTodayEvents.map(e => getEventBulletText(e)),
  ];

  return `
    <div class="section summary-section">
      <div class="section-header today-summary">
        <span class="section-icon">☀️</span>
        <span class="section-title">Summary of Today</span>
        <span class="section-count">${bullets.length} items</span>
      </div>
      <ul class="summary-bullets">
        ${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Render the Today Details section (full cards for today's items)
 */
function renderTodayDetails(
  summary: PersonalizedSummaryWithActions
): string {
  // Collect all today items
  const allTodayTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_todos),
    ...summary.family_wide.today_todos,
  ];
  const allTodayEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_events as EventWithAction[]),
    ...(summary.family_wide.today_events as EventWithAction[]),
  ];

  if (allTodayTodos.length === 0 && allTodayEvents.length === 0) {
    return '';
  }

  return `
    <div class="section">
      <div class="section-header today-details">
        <span class="section-icon">📋</span>
        <span class="section-title">Today's Details</span>
      </div>
      <div class="items-list">
        ${renderItemsFlat(allTodayTodos, allTodayEvents)}
      </div>
    </div>
  `;
}

/**
 * Render the For Consideration section (compact bullet list of upcoming items)
 */
function renderForConsiderationSection(
  summary: PersonalizedSummaryWithActions
): string {
  // Collect all upcoming items
  const allUpcomingTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_todos),
    ...summary.family_wide.upcoming_todos,
  ];
  const allUpcomingEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_events as EventWithAction[]),
    ...(summary.family_wide.upcoming_events as EventWithAction[]),
  ];

  if (allUpcomingTodos.length === 0 && allUpcomingEvents.length === 0) {
    return '';
  }

  // Create compact bullet list with dates
  const todoBullets = allUpcomingTodos.map(t => {
    const dueDate = t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : '';
    const emoji = getTodoTypeEmoji(t.type);
    const childPrefix = t.child_name && t.child_name !== 'General' ? `[${t.child_name}] ` : '';
    return `${emoji} ${childPrefix}${t.description}${dueDate ? ` - ${dueDate}` : ''}`;
  });

  const eventBullets = allUpcomingEvents.map(e => {
    const eventDate = new Date(e.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
    const childPrefix = e.child_name && e.child_name !== 'General' ? `[${e.child_name}] ` : '';
    return `📅 ${childPrefix}${e.title} - ${eventDate}`;
  });

  const allBullets = [...todoBullets, ...eventBullets];

  return `
    <div class="section compact-section">
      <div class="section-header consideration">
        <span class="section-icon">💭</span>
        <span class="section-title">For Consideration</span>
        <span class="section-count">${allBullets.length} items</span>
      </div>
      <ul class="compact-bullets">
        ${allBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Render the Week Calendar section (7-day overview)
 */
function renderWeekCalendar(
  summary: PersonalizedSummaryWithActions
): string {
  // Collect all upcoming items
  const allUpcomingTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_todos),
    ...summary.family_wide.upcoming_todos,
  ];
  const allUpcomingEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_events as EventWithAction[]),
    ...(summary.family_wide.upcoming_events as EventWithAction[]),
  ];

  if (allUpcomingTodos.length === 0 && allUpcomingEvents.length === 0) {
    return '';
  }

  // Group items by day
  const dayMap = new Map<string, { todos: TodoWithAction[]; events: EventWithAction[] }>();

  // Initialize next 7 days
  const today = new Date();
  for (let i = 1; i <= 7; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);
    const dayKey = day.toISOString().split('T')[0];
    dayMap.set(dayKey, { todos: [], events: [] });
  }

  // Group todos by day
  for (const todo of allUpcomingTodos) {
    if (todo.due_date) {
      const dayKey = new Date(todo.due_date).toISOString().split('T')[0];
      if (dayMap.has(dayKey)) {
        dayMap.get(dayKey)!.todos.push(todo);
      }
    }
  }

  // Group events by day
  for (const event of allUpcomingEvents) {
    const dayKey = new Date(event.date).toISOString().split('T')[0];
    if (dayMap.has(dayKey)) {
      dayMap.get(dayKey)!.events.push(event);
    }
  }

  // Render calendar rows
  const rows: string[] = [];
  for (const [dayKey, items] of dayMap) {
    const day = new Date(dayKey);
    const dayLabel = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const totalItems = items.todos.length + items.events.length;

    if (totalItems === 0) continue;

    // Create compact item list for this day
    const itemTexts = [
      ...items.events.map(e => e.title),
      ...items.todos.map(t => `${getTodoTypeEmoji(t.type)} ${t.description}`),
    ].slice(0, 3); // Show max 3 items per day

    const moreCount = totalItems - itemTexts.length;
    const moreText = moreCount > 0 ? ` +${moreCount} more` : '';

    rows.push(`
      <div class="calendar-day">
        <span class="calendar-date">${dayLabel}</span>
        <span class="calendar-items">${itemTexts.join(', ')}${moreText}</span>
      </div>
    `);
  }

  if (rows.length === 0) {
    return '';
  }

  return `
    <div class="section compact-section">
      <div class="section-header calendar">
        <span class="section-icon">📆</span>
        <span class="section-title">This Week</span>
      </div>
      <div class="week-calendar">
        ${rows.join('')}
      </div>
    </div>
  `;
}

// Insights section replaced by Summary of Today section

/**
 * Render complete personalized email
 */
export function renderPersonalizedEmail(summary: PersonalizedSummaryWithActions): string {
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
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f0f2f5;
      margin: 0;
      padding: 16px;
    }
    .container {
      max-width: 900px;
      width: 100%;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.08);
      padding: 32px 40px;
    }
    @media (max-width: 640px) {
      body { padding: 8px; }
      .container { padding: 20px 16px; border-radius: 8px; }
    }

    /* Header */
    .header {
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e8e8e8;
    }
    .header::after {
      content: "";
      display: table;
      clear: both;
    }
    .header h1 {
      margin: 0;
      color: #1a1a1a;
      font-size: 24px;
      font-weight: 700;
      display: inline-block;
    }
    .header .date {
      color: #666;
      font-size: 14px;
      float: right;
      margin-top: 8px;
    }
    @media (max-width: 500px) {
      .header .date { float: none; display: block; margin-top: 8px; }
    }

    /* Sections */
    .section {
      margin-bottom: 28px;
    }
    .section-header {
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e8e8e8;
    }
    .section-header.essential {
      border-bottom-color: #ff9800;
    }
    .section-header.consideration {
      border-bottom-color: #667eea;
    }
    .section-icon {
      font-size: 20px;
      vertical-align: middle;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
      vertical-align: middle;
    }
    .section-count {
      font-size: 13px;
      color: #888;
      float: right;
    }
    .section-subtitle {
      color: #666;
      font-size: 13px;
      margin: 0 0 16px 0;
    }
    .items-list {
      display: block;
    }

    /* Todo items */
    .todo-item {
      display: block;
      padding: 16px 20px;
      background: #fafafa;
      border-radius: 8px;
      border-left: 4px solid #667eea;
      margin-bottom: 12px;
    }
    .todo-header {
      margin-bottom: 8px;
    }
    .todo-header::after {
      content: "";
      display: table;
      clear: both;
    }
    .todo-type {
      display: inline-block;
      font-weight: 600;
      color: #667eea;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .amount-badge {
      display: inline-block;
      background: #e53935;
      color: white;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      margin-left: 10px;
    }
    .todo-description {
      font-size: 15px;
      line-height: 1.5;
      color: #333;
      margin-bottom: 8px;
    }
    .todo-meta {
      font-size: 13px;
      color: #666;
      margin-bottom: 8px;
    }
    .todo-meta span {
      display: inline-block;
      margin-right: 16px;
    }
    .todo-actions {
      margin-top: 8px;
    }
    .todo-actions a {
      margin-right: 10px;
    }

    /* Event items */
    .event-item {
      display: block;
      padding: 16px 20px;
      background: #f0f7ff;
      border-radius: 8px;
      border-left: 4px solid #2196f3;
      margin-bottom: 12px;
    }
    .event-header {
      margin-bottom: 6px;
    }
    .event-title {
      display: inline-block;
      font-weight: 600;
      font-size: 15px;
      color: #1565c0;
    }
    .event-meta {
      margin-bottom: 6px;
    }
    .event-meta span {
      display: inline-block;
      margin-right: 12px;
    }
    .event-date, .event-location {
      font-size: 13px;
      color: #555;
    }
    .event-description {
      font-size: 14px;
      color: #555;
      line-height: 1.4;
    }
    .child-badge {
      display: inline-block;
      background: #e8f4fd;
      color: #1976d2;
      padding: 2px 10px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 12px;
    }

    /* Buttons - ensure white text in all states */
    .action-button,
    .action-button:link,
    .action-button:visited,
    .action-button:hover,
    .action-button:active {
      display: inline-block;
      background: #43a047;
      color: #ffffff !important;
      padding: 7px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .action-button:hover { background: #388e3c; }
    .complete-button,
    .complete-button:link,
    .complete-button:visited,
    .complete-button:hover,
    .complete-button:active {
      display: inline-block;
      background: #667eea;
      color: #ffffff !important;
      padding: 7px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .complete-button:hover { background: #5a6fd6; }
    .remove-button,
    .remove-button:link,
    .remove-button:visited,
    .remove-button:hover,
    .remove-button:active {
      display: inline-block;
      float: right;
      background: #ef5350;
      color: #ffffff !important;
      padding: 5px 12px;
      border-radius: 5px;
      text-decoration: none;
      font-weight: 500;
      font-size: 12px;
    }
    .remove-button:hover { background: #e53935; }

    /* Payment provider badge (when no direct link) */
    .payment-provider-badge {
      display: inline-block;
      background: #fff3e0;
      color: #e65100;
      padding: 7px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      border: 1px solid #ffcc80;
    }

    /* Summary of Today section */
    .summary-section {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px 24px;
      border-radius: 10px;
      margin-bottom: 24px;
    }
    .summary-section .section-header {
      color: white;
      border-bottom: none;
      padding-bottom: 8px;
    }
    .summary-section .section-title {
      color: white;
    }
    .summary-section .section-count {
      background: rgba(255,255,255,0.2);
      color: white;
    }
    .summary-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .summary-bullets li {
      color: rgba(255,255,255,0.95);
      padding: 6px 0;
      font-size: 14px;
      line-height: 1.4;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .summary-bullets li:last-child {
      border-bottom: none;
    }

    /* Compact sections (For Consideration, Week Calendar) */
    .compact-section {
      background: #f8f9fa;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .compact-section .section-header {
      border-bottom: none;
      padding-bottom: 8px;
    }
    .compact-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .compact-bullets li {
      color: #555;
      padding: 4px 0;
      font-size: 13px;
      line-height: 1.4;
    }

    /* Week Calendar */
    .week-calendar {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .calendar-day {
      display: flex;
      align-items: flex-start;
      padding: 8px 0;
      border-bottom: 1px solid #e8e8e8;
    }
    .calendar-day:last-child {
      border-bottom: none;
    }
    .calendar-date {
      font-weight: 600;
      color: #333;
      min-width: 80px;
      font-size: 13px;
    }
    .calendar-items {
      color: #666;
      font-size: 13px;
      line-height: 1.4;
    }

    /* Section header variants */
    .section-header.today-summary .section-icon,
    .section-header.today-details .section-icon,
    .section-header.calendar .section-icon {
      font-size: 18px;
    }

    /* Empty state */
    .empty-state {
      color: #888;
      font-size: 14px;
      padding: 24px;
      text-align: center;
      background: #f8f9fa;
      border-radius: 8px;
    }

    /* Footer */
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e8e8e8;
      text-align: center;
      color: #888;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📬 Family Briefing</h1>
      <div class="date">${dateStr}</div>
    </div>

    ${renderTodaySummary(summary)}

    ${renderTodayDetails(summary)}

    ${renderWeekCalendar(summary)}

    ${renderForConsiderationSection(summary)}

    <div class="footer">
      Generated by Inbox Manager
    </div>
  </div>
</body>
</html>
  `;
}
