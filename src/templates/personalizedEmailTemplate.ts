// src/templates/personalizedEmailTemplate.ts

import type { PersonalizedSummary, ChildSummary, FamilySummary } from '../utils/personalizedSummaryBuilder.js';
import type { Todo } from '../types/todo.js';
import type { ExtractedEvent, TodoType } from '../types/extraction.js';
import { getTodoTypeLabel, getTodoTypeEmoji } from '../types/extraction.js';
import { getPaymentButtonInfo, extractPaymentProvider, isValidAmount } from '../utils/paymentProviders.js';

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
  highlight?: string; // AI-generated #1 thing to remember today
  emailsAnalyzed?: number; // Count of emails analyzed for this summary
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
 * Check if a date is today
 */
function isToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

/**
 * Check if a date is tomorrow
 */
function isTomorrow(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString();
}

/**
 * Check if a date is within the next N days (excluding today)
 */
function isWithinDays(date: Date | string, days: number): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + days);
  return d > today && d <= futureDate;
}

/**
 * Evening reminder todo types - things to do tonight/prepare for tomorrow
 */
const EVENING_TODO_TYPES: TodoType[] = ['READ', 'PACK', 'BUY', 'PAY', 'FILL', 'SIGN', 'REMIND'];

/**
 * Get today's reminders - things happening/due TODAY
 * Includes: PACK items for today, events today, todos due today
 */
function getTodayReminders(summary: PersonalizedSummaryWithActions): {
  todos: TodoWithAction[];
  events: EventWithAction[];
} {
  const allTodayTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_todos),
    ...summary.family_wide.today_todos,
  ];
  const allTodayEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.today_events as EventWithAction[]),
    ...(summary.family_wide.today_events as EventWithAction[]),
  ];

  return { todos: allTodayTodos, events: allTodayEvents };
}

/**
 * Get evening reminders - things to prepare/do tonight
 * Includes: READ, PACK (for tomorrow), BUY, PAY, FILL, SIGN, homework due this week
 * Excludes: events, items due next week+
 */
function getEveningReminders(summary: PersonalizedSummaryWithActions): TodoWithAction[] {
  const allUpcomingTodos: TodoWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_todos),
    ...summary.family_wide.upcoming_todos,
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneWeekFromNow = new Date(today);
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

  return allUpcomingTodos.filter(todo => {
    // Only include relevant evening types
    if (!EVENING_TODO_TYPES.includes(todo.type)) {
      return false;
    }

    // Include items without due date (they need to be done soon)
    if (!todo.due_date) {
      return true;
    }

    // Include items due within the next week
    const dueDate = new Date(todo.due_date);
    return dueDate <= oneWeekFromNow;
  });
}

/**
 * Get diary events for next 7 days
 * Returns events grouped by date
 */
function getDiaryEvents(summary: PersonalizedSummaryWithActions): Map<string, EventWithAction[]> {
  const allUpcomingEvents: EventWithAction[] = [
    ...summary.by_child.flatMap(c => c.upcoming_events as EventWithAction[]),
    ...(summary.family_wide.upcoming_events as EventWithAction[]),
  ];

  // Group events by date
  const eventsByDate = new Map<string, EventWithAction[]>();

  // Initialize next 7 days
  const today = new Date();
  for (let i = 1; i <= 7; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);
    const dayKey = day.toISOString().split('T')[0];
    eventsByDate.set(dayKey, []);
  }

  // Group events by day
  for (const event of allUpcomingEvents) {
    const dayKey = new Date(event.date).toISOString().split('T')[0];
    if (eventsByDate.has(dayKey)) {
      eventsByDate.get(dayKey)!.push(event);
    }
  }

  return eventsByDate;
}

/**
 * Render a single todo item
 * @param todo - The todo item (with optional actionUrl)
 * @param size - Card size: 'large' (default) or 'small'
 */
function renderTodo(todo: TodoWithAction, size: 'large' | 'small' = 'large'): string {
  const typeEmoji = getTodoTypeEmoji(todo.type);
  const typeLabel = getTodoTypeLabel(todo.type);
  const dueDate = todo.due_date ? formatDate(todo.due_date) : null;
  const amountBadge = isValidAmount(todo.amount) ? `<span class="amount-badge">${escapeHtml(todo.amount)}</span>` : '';

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
    ? `<a href="${escapeHtml(todo.actionUrl)}" class="complete-button${size === 'small' ? ' complete-button-small' : ''}">✓ Done</a>`
    : '';

  // Build meta items
  const metaItems: string[] = [];
  if (dueDate) metaItems.push(`<span>⏰ ${dueDate}</span>`);
  if (todo.child_name && todo.child_name !== 'General') {
    metaItems.push(`<span class="child-badge">👶 ${escapeHtml(todo.child_name)}</span>`);
  }

  const cardClass = size === 'small' ? 'todo-item todo-item-small' : 'todo-item';

  return `
    <div class="${cardClass}">
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
 * @param size - Card size: 'large' (default) or 'small'
 */
function renderEvent(event: EventWithAction, size: 'large' | 'small' = 'large'): string {
  const eventDate = formatDate(event.date);
  const location = event.location ? `<div class="event-location">📍 ${escapeHtml(event.location)}</div>` : '';
  const childBadge = event.child_name && event.child_name !== 'General'
    ? `<span class="child-badge">👶 ${escapeHtml(event.child_name)}</span>`
    : '';

  // Remove button (if actionUrl provided - token-based)
  const removeButton = event.actionUrl
    ? `<a href="${escapeHtml(event.actionUrl)}" class="remove-button${size === 'small' ? ' remove-button-small' : ''}">✕ Remove</a>`
    : '';

  const cardClass = size === 'small' ? 'event-item event-item-small' : 'event-item';

  return `
    <div class="${cardClass}">
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
 * Render the "work done" text showing how many emails were analyzed
 */
function renderWorkDone(emailsAnalyzed?: number): string {
  if (!emailsAnalyzed || emailsAnalyzed === 0) {
    return '';
  }

  return `
    <div class="work-done-text">
      The Family Assistant AI has summarised ${emailsAnalyzed} of your emails into this single email.
    </div>
  `;
}

/**
 * Render the #1 thing to remember today (highlight banner)
 */
function renderHighlight(highlight?: string): string {
  if (!highlight) {
    return '';
  }

  return `
    <div class="highlight-banner">
      <div class="highlight-header">
        <span class="highlight-icon">⭐</span>
        <span class="highlight-title">#1 THING TO REMEMBER TODAY</span>
      </div>
      <div class="highlight-content">
        ${escapeHtml(highlight)}
      </div>
    </div>
  `;
}

/**
 * Render today's reminders section (large cards)
 */
function renderTodayRemindersSection(summary: PersonalizedSummaryWithActions): string {
  const { todos, events } = getTodayReminders(summary);

  if (todos.length === 0 && events.length === 0) {
    return `
      <div class="section">
        <div class="section-header today-reminders">
          <span class="section-icon">📋</span>
          <span class="section-title">TODAY'S REMINDERS</span>
        </div>
        <div class="empty-state">✓ Nothing scheduled for today - enjoy your day!</div>
      </div>
    `;
  }

  return `
    <div class="section">
      <div class="section-header today-reminders">
        <span class="section-icon">📋</span>
        <span class="section-title">TODAY'S REMINDERS</span>
        <span class="section-count">${todos.length + events.length} items</span>
      </div>
      <div class="items-list">
        ${events.map(e => renderEvent(e, 'large')).join('')}
        ${todos.map(t => renderTodo(t, 'large')).join('')}
      </div>
    </div>
  `;
}

/**
 * Render evening reminders section (small cards)
 */
function renderEveningRemindersSection(summary: PersonalizedSummaryWithActions): string {
  const eveningTodos = getEveningReminders(summary);

  if (eveningTodos.length === 0) {
    return '';
  }

  return `
    <div class="section">
      <div class="section-header evening-reminders">
        <span class="section-icon">🌙</span>
        <span class="section-title">THIS EVENING'S REMINDERS</span>
        <span class="section-count">${eveningTodos.length} items</span>
      </div>
      <div class="items-grid">
        ${eveningTodos.map(t => renderTodo(t, 'small')).join('')}
      </div>
    </div>
  `;
}

/**
 * Render diary section (next 7 days events)
 */
function renderDiarySection(summary: PersonalizedSummaryWithActions): string {
  const eventsByDate = getDiaryEvents(summary);

  // Check if there are any events
  let totalEvents = 0;
  for (const events of eventsByDate.values()) {
    totalEvents += events.length;
  }

  if (totalEvents === 0) {
    return '';
  }

  // Build diary rows
  const rows: string[] = [];
  for (const [dayKey, events] of eventsByDate) {
    if (events.length === 0) continue;

    const day = new Date(dayKey);
    const dayLabel = day.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });

    for (const event of events) {
      const time = new Date(event.date).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const childLabel = event.child_name && event.child_name !== 'General'
        ? `<span class="diary-child">[${escapeHtml(event.child_name)}]</span>`
        : '';

      rows.push(`
        <div class="diary-row">
          <span class="diary-date">${dayLabel}</span>
          <span class="diary-event">${childLabel} ${escapeHtml(event.title)} ${time !== '00:00' ? `at ${time}` : ''}</span>
        </div>
      `);
    }
  }

  return `
    <div class="section diary-section">
      <div class="section-header diary">
        <span class="section-icon">📅</span>
        <span class="section-title">DIARY - NEXT 7 DAYS</span>
      </div>
      <div class="diary-list">
        ${rows.join('')}
      </div>
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
  const amount = isValidAmount(todo.amount) ? ` (${todo.amount})` : '';
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

// Legacy functions kept for backward compatibility but not used in new structure

/**
 * Render complete personalized email
 */
export function renderPersonalizedEmail(summary: PersonalizedSummaryWithActions): string {
  const dateStr = summary.generated_at.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Family Briefing</title>
  <style>
    /* Email-safe CSS - avoid flexbox, grid, gradients for Outlook compatibility */
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f0f2f5;
      margin: 0;
      padding: 8px;
    }
    .container {
      max-width: 700px;
      width: 100%;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      padding: 24px 16px;
    }
    @media screen and (min-width: 480px) {
      body { padding: 16px; }
      .container { padding: 32px 40px; }
    }

    /* Prevent long text from causing overflow */
    .todo-description, .event-title, .event-description, .highlight-content, .diary-event {
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Header */
    .header {
      text-align: center;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 2px solid #e8e8e8;
    }
    .header h1 {
      margin: 0 0 4px 0;
      color: #1a1a1a;
      font-size: 28px;
      font-weight: 700;
    }
    .header .date {
      color: #666;
      font-size: 16px;
      margin: 0;
    }

    /* Work Done text */
    .work-done-text {
      text-align: center;
      color: #888;
      font-size: 13px;
      margin-bottom: 24px;
      font-style: italic;
    }

    /* Highlight Banner - using solid color for email compatibility */
    .highlight-banner {
      background-color: #fff9c4;
      border: 2px solid #ffd54f;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 28px;
    }
    @media screen and (min-width: 480px) {
      .highlight-banner { padding: 20px 24px; }
    }
    .highlight-header {
      display: block;
      margin-bottom: 12px;
    }
    .highlight-icon {
      display: inline-block;
      font-size: 24px;
      margin-right: 10px;
      vertical-align: middle;
    }
    .highlight-title {
      display: inline-block;
      font-size: 14px;
      font-weight: 700;
      color: #f57f17;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      vertical-align: middle;
    }
    .highlight-content {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      line-height: 1.4;
    }

    /* Sections */
    .section {
      margin-bottom: 28px;
    }
    .section-header {
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e8e8e8;
    }
    .section-header.today-reminders {
      border-bottom-color: #667eea;
    }
    .section-header.evening-reminders {
      border-bottom-color: #9575cd;
    }
    .section-header.diary {
      border-bottom-color: #4fc3f7;
    }
    .section-icon {
      font-size: 20px;
      vertical-align: middle;
      margin-right: 8px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
      vertical-align: middle;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .section-count {
      display: inline-block;
      font-size: 12px;
      color: #888;
      margin-left: 10px;
    }
    .items-list {
      display: block;
    }

    /* Todo items - Large (default) */
    .todo-item {
      display: block;
      padding: 16px;
      background: #fafafa;
      border-radius: 10px;
      border-left: 4px solid #667eea;
      margin-bottom: 12px;
    }
    @media screen and (min-width: 480px) {
      .todo-item { padding: 20px 24px; }
    }
    .todo-header {
      display: block;
      margin-bottom: 8px;
    }
    .todo-type {
      display: inline-block;
      font-weight: 600;
      color: #667eea;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .amount-badge {
      display: inline-block;
      background: #e53935;
      color: white;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 10px;
    }
    .todo-description {
      font-size: 16px;
      line-height: 1.5;
      color: #333;
      margin-bottom: 8px;
      font-weight: 500;
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
      margin-top: 12px;
    }
    .todo-actions a {
      margin-right: 10px;
    }

    /* Todo items - Small */
    .todo-item-small {
      padding: 12px 16px;
      border-radius: 8px;
      border-left-width: 3px;
      margin-bottom: 8px;
    }
    .todo-item-small .todo-description {
      font-size: 14px;
      margin-bottom: 4px;
    }
    .todo-item-small .todo-meta {
      font-size: 12px;
      margin-bottom: 4px;
    }
    .todo-item-small .todo-actions {
      margin-top: 8px;
    }

    /* Event items - Large (default) */
    .event-item {
      display: block;
      padding: 16px;
      background: #f0f7ff;
      border-radius: 10px;
      border-left: 4px solid #2196f3;
      margin-bottom: 12px;
    }
    @media screen and (min-width: 480px) {
      .event-item { padding: 20px 24px; }
    }
    .event-header {
      margin-bottom: 6px;
    }
    .event-title {
      display: inline-block;
      font-weight: 600;
      font-size: 16px;
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

    /* Event items - Small */
    .event-item-small {
      padding: 12px 16px;
      border-radius: 8px;
      border-left-width: 3px;
      margin-bottom: 8px;
    }
    .event-item-small .event-title {
      font-size: 14px;
    }

    /* Items grid for evening reminders - using block display for email compatibility */
    .items-grid {
      display: block;
    }

    .child-badge {
      display: inline-block;
      background: #e8f4fd;
      color: #1976d2;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 11px;
    }

    /* Buttons - email-safe styles (no :hover for email compatibility) */
    .action-button {
      display: inline-block;
      background-color: #43a047;
      color: #ffffff !important;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }

    .complete-button {
      display: inline-block;
      background-color: #667eea;
      color: #ffffff !important;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }

    .complete-button-small {
      padding: 5px 12px;
      font-size: 12px;
    }

    .remove-button {
      display: inline-block;
      background-color: #ef5350;
      color: #ffffff !important;
      padding: 5px 12px;
      border-radius: 5px;
      text-decoration: none;
      font-weight: 500;
      font-size: 12px;
    }

    .remove-button-small {
      padding: 4px 10px;
      font-size: 11px;
    }

    /* Payment provider badge */
    .payment-provider-badge {
      display: inline-block;
      background: #fff3e0;
      color: #e65100;
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      border: 1px solid #ffcc80;
    }

    /* Diary section */
    .diary-section {
      background: #f8f9fa;
      padding: 16px;
      border-radius: 10px;
    }
    @media screen and (min-width: 480px) {
      .diary-section { padding: 20px 24px; }
    }
    .diary-section .section-header {
      border-bottom: none;
      padding-bottom: 12px;
    }
    .diary-list {
      display: block;
    }
    .diary-row {
      display: block;
      padding: 12px 0;
      border-bottom: 1px solid #e8e8e8;
    }
    .diary-date {
      display: block;
      font-weight: 600;
      color: #333;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .diary-event {
      display: block;
      color: #555;
      font-size: 14px;
      line-height: 1.4;
      padding-left: 12px;
    }
    .diary-child {
      color: #1976d2;
      font-weight: 500;
      font-size: 12px;
      margin-right: 4px;
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
      <h1>Family Briefing</h1>
      <p class="date">${dateStr}</p>
    </div>

    ${renderWorkDone(summary.emailsAnalyzed)}

    ${renderHighlight(summary.highlight)}

    ${renderTodayRemindersSection(summary)}

    ${renderEveningRemindersSection(summary)}

    ${renderDiarySection(summary)}

    <div class="footer">
      Generated by Family Assistant
    </div>
  </div>
</body>
</html>
  `;
}
