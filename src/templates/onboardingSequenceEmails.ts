// src/templates/onboardingSequenceEmails.ts
// Templates for the 7-day onboarding email sequence.

import type { ChildProfile } from '../types/childProfile.js';
import type { PersonalizedSummaryWithActions, TodoWithAction, EventWithAction } from './personalizedEmailTemplate.js';

function brandedWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Family Assistant</title>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #F5F7FA; margin: 0; padding: 40px 20px; }
    .card { background: white; border-radius: 16px; max-width: 560px; margin: 0 auto; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h1 { font-family: Georgia, serif; font-size: 24px; color: #1E4562; margin: 0 0 16px; }
    p { color: #4A6B8A; font-size: 15px; line-height: 1.6; margin: 0 0 14px; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #9CA3AF; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${body}
  </div>
  <div class="footer">Family Assistant · <a href="{{unsubscribe_url}}" style="color:#9CA3AF;">Unsubscribe</a></div>
</body>
</html>`;
}

function escHtml(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return map[m];
  });
}

/**
 * Day 1: Inaugural briefing — combines the welcome message with the first
 * generated briefing content into a single email.
 *
 * Returns { html, subject } so the caller can use the correct subject line.
 */
export function renderInauguralBriefingEmail(params: {
  userName: string;
  childProfiles: ChildProfile[];
  summary: PersonalizedSummaryWithActions;
  baseUrl: string;
}): { html: string; subject: string } {
  const { userName, childProfiles, summary, baseUrl } = params;

  // Subject line
  const childNames = childProfiles.map(p => escHtml(p.display_name || p.real_name)).join(' & ');
  const dateStr = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(summary.generated_at);
  const subject = `Your Family Briefing: ${childNames || 'Your Family'} | ${dateStr} 🗓️`;

  // Map child name → school for label generation
  const schoolMap = new Map<string, string>();
  for (const p of childProfiles) {
    if (p.school_name) {
      schoolMap.set((p.display_name || p.real_name).toLowerCase(), p.school_name);
    }
  }

  function childLabel(childName: string): string {
    const school = schoolMap.get(childName.toLowerCase());
    return school ? `${escHtml(childName)} (${escHtml(school)})` : escHtml(childName);
  }

  // Collect items by category
  const mustDoItems: Array<{ label: string; text: string }> = [];
  const financialItems: Array<{ label: string; text: string }> = [];
  const eventItems: Array<{ label: string; title: string; date?: string }> = [];

  function collectTodos(todos: TodoWithAction[], label: string) {
    for (const todo of todos) {
      const item = { label, text: escHtml(todo.description) };
      if ((todo as any).type === 'PAY') {
        financialItems.push(item);
      } else {
        mustDoItems.push(item);
      }
    }
  }

  function collectEvents(events: EventWithAction[], label: string) {
    for (const event of events) {
      eventItems.push({
        label,
        title: escHtml(event.title),
        date: (event as any).date || (event as any).start_date || undefined,
      });
    }
  }

  for (const child of summary.by_child) {
    const label = childLabel(child.display_name || child.child_name);
    collectTodos([...child.today_todos, ...child.upcoming_todos], label);
    collectEvents([...child.today_events, ...child.upcoming_events], label);
  }
  collectTodos([...summary.family_wide.today_todos, ...summary.family_wide.upcoming_todos], 'Family');
  collectEvents([...summary.family_wide.today_events, ...summary.family_wide.upcoming_events], 'Family');

  // Render helpers
  const empty = (msg: string) => `<p style="color:#9CA3AF;font-size:13px;font-style:italic;padding:4px 0;">${msg}</p>`;

  function renderTodoItems(items: Array<{ label: string; text: string }>): string {
    if (items.length === 0) return empty('Nothing found yet — this will fill up as more emails arrive.');
    return items.map(item => `
      <div style="margin:10px 0;padding:12px 16px;background:#F9FBFD;border-left:3px solid #2A5C82;border-radius:0 8px 8px 0;font-size:14px;color:#2C3E50;line-height:1.5;">
        <div style="font-size:11px;font-weight:600;color:#7A8FA3;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${item.label}</div>
        ${item.text}
      </div>`).join('');
  }

  function renderEventItems(items: Array<{ label: string; title: string; date?: string }>): string {
    if (items.length === 0) return empty('No events detected yet.');
    return items.map(item => {
      const dateTag = item.date
        ? ` — <span style="color:#2A5C82;font-weight:600;">${escHtml(item.date)}</span>`
        : '';
      return `
      <div style="margin:10px 0;padding:12px 16px;background:#F9FBFD;border-left:3px solid #4A9B6F;border-radius:0 8px 8px 0;font-size:14px;color:#2C3E50;line-height:1.5;">
        <div style="font-size:11px;font-weight:600;color:#7A8FA3;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${item.label}</div>
        ${item.title}${dateTag}
      </div>`;
    }).join('');
  }

  // Family profiles section
  const profilesHtml = childProfiles.length > 0
    ? childProfiles.map(p => {
        const name = escHtml(p.display_name || p.real_name);
        const detail = [p.year_group, p.school_name].filter(Boolean).map(escHtml).join(', ');
        return `<div style="display:inline-block;background:#EEF3F8;border-radius:10px;padding:10px 16px;margin:0 8px 8px 0;vertical-align:top;">
          <span style="font-weight:700;color:#1E4562;font-size:14px;display:block;">${name}</span>
          ${detail ? `<span style="color:#4A6B8A;font-size:13px;display:block;margin-top:2px;">${detail}</span>` : ''}
        </div>`;
      }).join('')
    : empty('No child profiles set up.');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Family Briefing — Family Assistant</title>
</head>
<body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#F5F7FA;margin:0;padding:40px 20px;">
  <div style="background:white;border-radius:16px;max-width:560px;margin:0 auto;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <div style="font-family:Georgia,serif;font-size:26px;color:#1E4562;margin:0 0 16px;line-height:1.3;">The &#8220;Magic&#8221; has happened. ✨</div>

    <p style="color:#4A6B8A;font-size:15px;line-height:1.6;margin:0 0 14px;">Hi ${escHtml(userName || 'there')},</p>

    <p style="color:#4A6B8A;font-size:15px;line-height:1.6;margin:0 0 20px;">I've finished sifting through the first few emails you forwarded. Here is your inaugural Family Assistant Briefing — I've pulled out the signal from the noise so you can get on with your morning.</p>

    <!-- Family Profiles -->
    <div style="font-family:Georgia,serif;font-size:18px;color:#1E4562;margin:28px 0 12px;border-bottom:1px solid #E0E7ED;padding-bottom:8px;">🏠 Your Family Profiles</div>
    <div style="margin-bottom:8px;">${profilesHtml}</div>

    <!-- What I found -->
    <div style="font-family:Georgia,serif;font-size:18px;color:#1E4562;margin:28px 0 12px;border-bottom:1px solid #E0E7ED;padding-bottom:8px;">📬 What I found in your inbox</div>

    <p style="margin:0 0 8px;font-size:15px;color:#1E4562;">
      <strong>1. The &#8220;Must-Do&#8221;</strong>
      <span style="color:#7A8FA3;font-size:13px;"> (Action Required)</span>
    </p>
    ${renderTodoItems(mustDoItems)}

    <p style="margin:20px 0 8px;font-size:15px;color:#1E4562;">
      <strong>2. The &#8220;Don&#8217;t Forget&#8221;</strong>
      <span style="color:#7A8FA3;font-size:13px;"> (Important Dates &amp; Events)</span>
    </p>
    ${renderEventItems(eventItems)}

    <p style="margin:20px 0 8px;font-size:15px;color:#1E4562;">
      <strong>3. The &#8220;Financials&#8221;</strong>
    </p>
    ${renderTodoItems(financialItems)}

    <!-- Auto-forwarding CTA -->
    <div style="background:linear-gradient(135deg,#1E4562 0%,#2A5C82 100%);border-radius:12px;padding:24px;margin:32px 0;">
      <div style="font-family:Georgia,serif;font-size:18px;color:white;margin:0 0 8px;">🚀 The Next Step: Set and Forget</div>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;line-height:1.6;margin:0 0 16px;">You've seen what I can do with a handful of emails. Imagine never having to "find" a school PDF again. To get this briefing every morning at 7:00 AM automatically, set up Auto-Forwarding — it takes 30 seconds.</p>
      <a href="${escHtml(baseUrl)}/settings" style="display:inline-block;background:white;color:#1E4562;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Setup Auto-Forwarding →</a>
    </div>

    <!-- Founder quote -->
    <div style="border-left:3px solid #E0E7ED;padding:12px 16px;margin:24px 0;font-size:14px;color:#7A8FA3;font-style:italic;line-height:1.6;">
      "As a fellow parent, I know how much mental space those &#8216;quick updates&#8217; take up. I hope this gave you 5 minutes of your morning back."
    </div>

    <div style="margin-top:20px;font-size:14px;color:#4A6B8A;line-height:1.8;">
      <strong style="color:#1E4562;">[Your Name]</strong><br>
      Founder, Family Assistant
    </div>

  </div>
  <div style="text-align:center;margin-top:24px;font-size:12px;color:#9CA3AF;">
    Family Assistant · <a href="#" style="color:#9CA3AF;">Unsubscribe</a>
  </div>
</body>
</html>`;

  return { html, subject };
}

/**
 * Day 2: Automation nudge — remind the user to set up forwarding filters.
 * <!-- TODO: design final copy -->
 */
export function renderDay2AutomationNudgeEmail(params: { userName: string }): string {
  const { userName } = params;
  return brandedWrapper(
    `${userName || 'Quick tip'}: make it automatic`,
    `<p>Did you know you can set up Gmail to forward school emails automatically? That way you'll never miss anything — even if you forget to check.</p>
    <p>Go to Gmail → Settings → Forwarding and add your Family Assistant address as a forwarding destination, then create a filter for each school sender.</p>
    <!-- TODO: design final copy -->`
  );
}

/**
 * Day 4: Magic feature highlight.
 * <!-- TODO: design final copy -->
 */
export function renderDay4MagicFeatureEmail(params: { userName: string }): string {
  const { userName } = params;
  return brandedWrapper(
    `${userName || 'Did you know'}? One-tap actions`,
    `<p>Every briefing email includes action buttons — tap "Done" on a todo and it's removed from your list instantly, no login required.</p>
    <p>Try it in your next briefing.</p>
    <!-- TODO: design final copy -->`
  );
}

/**
 * Day 5: Partner invite prompt.
 * <!-- TODO: design final copy -->
 */
export function renderDay5PartnerInviteEmail(params: { userName: string }): string {
  const { userName } = params;
  return brandedWrapper(
    `${userName || 'Share the load'} — invite your partner`,
    `<p>Family Assistant works best when both parents are in the loop. You can add your partner as a recipient so they get the same daily briefing.</p>
    <p>Go to Settings → Summary Recipients to add their email.</p>
    <!-- TODO: design final copy -->`
  );
}

/**
 * Day 6: Preview of what's been tracked.
 * <!-- TODO: design final copy -->
 */
export function renderDay6PreviewEmail(params: { userName: string; itemsTracked: number }): string {
  const { userName, itemsTracked } = params;
  return brandedWrapper(
    `${userName || 'Here\'s'} what we\'ve tracked so far`,
    `<p>In the last 6 days, Family Assistant has tracked <strong>${itemsTracked} items</strong> from your school emails — events, todos, and reminders.</p>
    <p>All the things you'd normally have to hunt through your inbox for, already organised.</p>
    <!-- TODO: design final copy -->`
  );
}

/**
 * Day 7: Trial ending / upgrade prompt.
 * <!-- TODO: design final copy -->
 */
export function renderDay7PaywallEmail(params: { userName: string }): string {
  const { userName } = params;
  return brandedWrapper(
    `${userName || 'Your'} free trial ends soon`,
    `<p>Your 7-day trial of Family Assistant is coming to an end. Upgrade to keep your daily briefings running.</p>
    <p><a href="{{upgrade_url}}" style="color:#2A5C82;font-weight:600;">View plans →</a></p>
    <!-- TODO: design final copy -->`
  );
}
