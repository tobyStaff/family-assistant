// src/utils/emailRenderer.ts
import type { InboxSummary, SchoolSummary, AnySummary, SummaryEmailItem, EmailCategory } from '../types/summary.js';
import { isSchoolSummary as checkIsSchoolSummary } from '../types/summary.js';

/**
 * Render a single email item as HTML
 */
function renderEmailItem(email: SummaryEmailItem): string {
  const actionBadge = email.actionNeeded
    ? `<span class="action-badge">ACTION: ${email.actionNeeded}</span>`
    : '';

  const deadline = email.deadline
    ? `<div class="deadline">⏰ Due: ${new Date(email.deadline).toLocaleDateString()}</div>`
    : '';

  return `
    <div class="email-item">
      <div class="email-from">${escapeHtml(email.from)}</div>
      <div class="email-subject">${escapeHtml(email.subject)}</div>
      <div class="email-summary">${escapeHtml(email.summary)}</div>
      ${actionBadge}
      ${deadline}
    </div>
  `;
}

/**
 * Render a category section
 */
function renderCategory(category: EmailCategory, icon: string): string {
  const priorityClass = `priority-${category.priority}`;

  // If category has no emails, show summary text instead
  if (!category.emails || category.emails.length === 0) {
    return `
      <div class="category ${priorityClass}">
        <div class="category-header">
          ${icon} ${escapeHtml(category.name)} (${category.count})
        </div>
        <p style="color: #666; padding: 15px 0;">${escapeHtml(category.summary || 'No items')}</p>
      </div>
    `;
  }

  const emailsHtml = category.emails
    .map((email) => renderEmailItem(email))
    .join('');

  return `
    <div class="category ${priorityClass}">
      <div class="category-header">
        ${icon} ${escapeHtml(category.name)} (${category.count})
      </div>
      ${emailsHtml}
    </div>
  `;
}

/**
 * Render upcoming TODOs and events
 */
function renderUpcoming(summary: InboxSummary): string {
  const todos = summary.upcomingReminders.todos || [];
  const events = summary.upcomingReminders.events || [];

  if (todos.length === 0 && events.length === 0) {
    return '';
  }

  const todosHtml = todos
    .map(
      (todo) => `
    <div class="upcoming-item">
      <div class="upcoming-icon">☑️</div>
      <div>
        <div class="upcoming-title">${escapeHtml(todo.description)}</div>
        ${todo.dueDate ? `<div class="upcoming-date">Due: ${new Date(todo.dueDate).toLocaleDateString()}</div>` : ''}
      </div>
    </div>
  `
    )
    .join('');

  const eventsHtml = events
    .map(
      (event) => `
    <div class="upcoming-item">
      <div class="upcoming-icon">📅</div>
      <div>
        <div class="upcoming-title">${escapeHtml(event.summary)}</div>
        <div class="upcoming-date">${new Date(event.start).toLocaleString()}</div>
      </div>
    </div>
  `
    )
    .join('');

  return `
    <div class="category">
      <div class="category-header">
        📅 Your Day Ahead
      </div>
      ${todosHtml}
      ${eventsHtml}
    </div>
  `;
}

/**
 * Render highlights list
 */
function renderHighlights(highlights: string[]): string {
  if (highlights.length === 0) {
    return '';
  }

  const highlightsHtml = highlights
    .map((highlight) => `<li>${escapeHtml(highlight)}</li>`)
    .join('');

  return `
    <div class="highlights">
      <ul>
        ${highlightsHtml}
      </ul>
    </div>
  `;
}

/**
 * Get tone emoji
 */
function getToneEmoji(tone: string): string {
  switch (tone) {
    case 'urgent':
      return '🔥';
    case 'busy':
      return '⚡';
    case 'calm':
      return '☀️';
    default:
      return '📬';
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render school summary email (new format)
 */
function renderSchoolSummaryEmail(summary: SchoolSummary, _emailCount?: number, _noiseCount?: number, dateRangeDescription?: string): string {
  // Render child summaries
  const summaryItems = summary.summary.map(item => `
    <div class="summary-item">
      <span class="child-icon">${item.icon}</span>
      <div>
        <strong>${escapeHtml(item.child)}:</strong>
        ${escapeHtml(item.text)}
      </div>
    </div>
  `).join('');

  // Render kit list for tomorrow (always show, with empty state)
  const tomorrowKitHtml = `
    <div class="kit-section">
      <h3 style="color: #d32f2f; margin-top: 0;">📦 Kit Needed Tomorrow</h3>
      ${summary.kit_list.tomorrow.length > 0
        ? summary.kit_list.tomorrow.map(kit => `
          <div class="kit-item">
            <strong>${escapeHtml(kit.item)}</strong>
            <div style="color: #666; font-size: 13px;">${escapeHtml(kit.context)}</div>
          </div>
        `).join('')
        : '<div style="color: #999; font-style: italic; font-size: 14px;">✓ No kit required tomorrow</div>'
      }
    </div>
  `;

  // Render upcoming kit (show only if there are items - this is optional info)
  const upcomingKitHtml = summary.kit_list.upcoming.length > 0 ? `
    <div class="kit-section" style="background: #f8f9fa; border-left-color: #6c757d;">
      <h3 style="margin-top: 0;">👕 Upcoming Kit</h3>
      ${summary.kit_list.upcoming.map(kit => `
        <div class="kit-item">
          <strong>${escapeHtml(kit.item)}</strong> - ${escapeHtml(kit.day)}
        </div>
      `).join('')}
    </div>
  ` : '';

  // Render financials (always show, with empty state)
  const financialsHtml = `
    <div class="section">
      <h2>💳 Payments Due</h2>
      ${summary.financials.length > 0
        ? summary.financials.map(fin => `
          <div class="financial-item">
            <div><strong>${escapeHtml(fin.description)}</strong></div>
            <div>Amount: <strong>${escapeHtml(fin.amount)}</strong></div>
            <div>Deadline: ${new Date(fin.deadline).toLocaleDateString()}</div>
            ${fin.payment_method ? `<div style="color: #666; font-size: 13px; margin-top: 4px;">Payment via: <strong>${escapeHtml(fin.payment_method)}</strong></div>` : ''}
            ${fin.url !== 'manual_check_required'
              ? `<div style="margin-top: 8px;"><a href="${escapeHtml(fin.url)}" style="color: #007bff; text-decoration: none; font-weight: 600;">Pay Now →</a></div>`
              : '<div style="color: #d32f2f; font-size: 13px; margin-top: 8px;">⚠️ Check email for payment link</div>'
            }
          </div>
        `).join('')
        : '<div style="color: #999; font-style: italic; font-size: 14px; padding: 12px; background: #f8f9fa; border-radius: 6px;">✓ No payments due</div>'
      }
    </div>
  `;

  // Render calendar updates (always show, with empty state)
  const calendarHtml = `
    <div class="section">
      <h2>📅 Calendar Updates</h2>
      ${summary.calendar_updates.length > 0
        ? summary.calendar_updates.map(cal => `
          <div class="calendar-item">
            <strong>${escapeHtml(cal.event)}</strong><br>
            ${new Date(cal.date).toLocaleDateString()} - <em>${escapeHtml(cal.action)}</em>
          </div>
        `).join('')
        : '<div style="color: #999; font-style: italic; font-size: 14px; padding: 12px; background: #f8f9fa; border-radius: 6px;">✓ No calendar updates</div>'
      }
    </div>
  `;

  // Render attachments requiring review (always show, with empty state)
  const attachmentsHtml = `
    <div class="section">
      <h2>📎 Attachments to Review</h2>
      ${summary.attachments_requiring_review.length > 0
        ? `<div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
            <div style="font-size: 13px; color: #856404; margin-bottom: 8px;">
              ⚠️ These emails contain attachments that need manual review
            </div>
          </div>
          ${summary.attachments_requiring_review.map(att => `
            <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid #6c757d;">
              <div><strong>${escapeHtml(att.subject)}</strong></div>
              <div style="font-size: 13px; color: #666; margin-top: 4px;">From: ${escapeHtml(att.from)}</div>
              <div style="font-size: 13px; color: #856404; margin-top: 4px; font-style: italic;">${escapeHtml(att.reason)}</div>
            </div>
          `).join('')}`
        : '<div style="color: #999; font-style: italic; font-size: 14px; padding: 12px; background: #f8f9fa; border-radius: 6px;">✓ No attachments requiring review</div>'
      }
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>School Day Summary</title>
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
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      padding: 30px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #4285f4;
    }
    h1 {
      margin: 0;
      color: #1a1a1a;
      font-size: 28px;
    }
    h2 {
      color: #1a1a1a;
      font-size: 20px;
      margin: 25px 0 15px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #e0e0e0;
    }
    h3 {
      color: #333;
      font-size: 16px;
      margin: 15px 0 10px 0;
    }
    .summary-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid #4285f4;
    }
    .child-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    .kit-section {
      background: #fff3cd;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      border-left: 4px solid #ffc107;
    }
    .kit-item {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .kit-item:last-child {
      border-bottom: none;
    }
    .section {
      margin: 25px 0;
    }
    .financial-item {
      background: #f8d7da;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 12px;
      border-left: 4px solid #dc3545;
    }
    .financial-item strong {
      color: #721c24;
    }
    .calendar-item {
      background: #d1ecf1;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 10px;
      border-left: 4px solid #17a2b8;
    }
    .whatsapp-section {
      background: #e7f3ff;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #2196f3;
    }
    .insight-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-top: 30px;
      text-align: center;
    }
    .insight-box strong {
      display: block;
      font-size: 16px;
      margin-bottom: 8px;
    }
    @media (max-width: 640px) {
      body { padding: 10px; }
      .container { padding: 20px; }
      h1 { font-size: 24px; }
      h2 { font-size: 18px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Daily Briefing</h1>
      <div style="color: #666; font-size: 14px; margin-top: 8px;">Your daily logistics briefing</div>
      ${summary.email_analysis ? `<div style="color: #888; font-size: 13px; margin-top: 12px; padding: 8px; background: #f5f5f5; border-radius: 4px;">
        [${summary.email_analysis.signal_count}] signal emails from ${summary.email_analysis.total_received} analyzed (from ${dateRangeDescription || 'the last 7 days'})
        ${summary.email_analysis.noise_count > 0 ? `<br>Removed [${summary.email_analysis.noise_count}] non-school emails` : ''}
        ${summary.email_analysis.noise_examples && summary.email_analysis.noise_examples.length > 0 ? `<br><span style="font-size: 12px; color: #999;">Examples: ${summary.email_analysis.noise_examples.slice(0, 3).map(ex => escapeHtml(ex)).join(', ')}</span>` : ''}
      </div>` : ''}
    </div>

    <div class="section">
      <h2>📋 Today's Updates</h2>
      ${summaryItems}
    </div>

    ${tomorrowKitHtml}
    ${upcomingKitHtml}
    ${financialsHtml}
    ${attachmentsHtml}
    ${calendarHtml}

    <div class="insight-box">
      <strong>💡 Pro Dad Insight</strong>
      <div>${escapeHtml(summary.pro_dad_insight)}</div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Render complete inbox summary email (original format)
 *
 * @param summary - AI-generated inbox summary
 * @returns HTML email string
 */
function renderInboxSummaryEmail(summary: InboxSummary): string {
  const toneEmoji = getToneEmoji(summary.summary.overallTone);
  const greeting = `${toneEmoji} ${summary.summary.greeting}`;

  // Render highlights
  const highlightsHtml = renderHighlights(summary.summary.highlights);

  // Render categories with appropriate icons
  const categoriesHtml = summary.categories
    .map((category) => {
      let icon = '📬';
      if (category.name.includes('Action')) {
        icon = '⚡';
      } else if (category.name.includes('Newsletter') || category.name.includes('Marketing')) {
        icon = '📰';
      } else if (category.name.includes('FYI') || category.name.includes('Update')) {
        icon = '📬';
      }
      return renderCategory(category, icon);
    })
    .join('');

  // Render upcoming section
  const upcomingHtml = renderUpcoming(summary);

  // Render stats
  const statsHtml = `
    <div class="stats">
      <strong>Summary:</strong> ${summary.stats.totalEmails} emails processed
      <br>
      ${summary.stats.actionRequired} need action • ${summary.stats.fyi} for review • ${summary.stats.lowPriority} skippable
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Inbox Summary</title>
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
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      padding: 30px;
    }
    .greeting {
      font-size: 24px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 20px;
    }
    .highlights {
      background: #f8f9fa;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      border-left: 4px solid #4285f4;
    }
    .highlights ul {
      margin: 0;
      padding-left: 20px;
    }
    .highlights li {
      margin: 8px 0;
      color: #444;
    }
    .category {
      margin: 30px 0;
    }
    .category-header {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
      padding: 12px 0;
      border-bottom: 2px solid #e0e0e0;
      margin-bottom: 10px;
    }
    .email-item {
      padding: 15px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .email-item:last-child {
      border-bottom: none;
    }
    .email-from {
      font-weight: 600;
      color: #1a1a1a;
      font-size: 15px;
      margin-bottom: 4px;
    }
    .email-subject {
      color: #666;
      font-size: 14px;
      margin-bottom: 6px;
    }
    .email-summary {
      color: #444;
      font-size: 14px;
      line-height: 1.5;
    }
    .action-badge {
      display: inline-block;
      background: #ff6b6b;
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .deadline {
      color: #d32f2f;
      font-size: 13px;
      margin-top: 6px;
      font-weight: 500;
    }
    .priority-high {
      border-left: 4px solid #ff6b6b;
      padding-left: 16px;
    }
    .priority-medium {
      border-left: 4px solid #ffa500;
      padding-left: 16px;
    }
    .priority-low {
      border-left: 4px solid #999;
      padding-left: 16px;
    }
    .upcoming-item {
      display: flex;
      align-items: flex-start;
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .upcoming-item:last-child {
      border-bottom: none;
    }
    .upcoming-icon {
      font-size: 20px;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .upcoming-title {
      font-weight: 500;
      color: #1a1a1a;
      margin-bottom: 4px;
    }
    .upcoming-date {
      font-size: 13px;
      color: #666;
    }
    .stats {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin-top: 30px;
      font-size: 14px;
      color: #444;
      line-height: 1.8;
    }
    .stats strong {
      color: #1a1a1a;
    }
    @media (max-width: 640px) {
      body {
        padding: 10px;
      }
      .container {
        padding: 20px;
      }
      .greeting {
        font-size: 20px;
      }
      .category-header {
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="greeting">${greeting}</div>

    ${highlightsHtml}

    ${categoriesHtml}

    ${upcomingHtml}

    ${statsHtml}
  </div>
</body>
</html>
  `.trim();
}

/**
 * Main export: Render summary email HTML (handles both formats)
 *
 * @param summary - AI-generated summary (InboxSummary or SchoolSummary)
 * @param emailCount - Number of emails processed (optional)
 * @param noiseCount - Number of emails filtered as noise (optional)
 * @param dateRangeDescription - Human-readable date range (e.g., "the last 7 days")
 * @returns HTML email string
 */
export function renderSummaryEmail(summary: AnySummary, emailCount?: number, noiseCount?: number, dateRangeDescription?: string): string {
  if (checkIsSchoolSummary(summary)) {
    return renderSchoolSummaryEmail(summary, emailCount, noiseCount, dateRangeDescription);
  } else {
    return renderInboxSummaryEmail(summary);
  }
}
