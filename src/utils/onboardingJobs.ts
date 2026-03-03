// src/utils/onboardingJobs.ts
//
// Background job runners for onboarding steps.
// Extracted from childProfileRoutes.ts to keep route files focused on HTTP handling.

import { fetchRecentEmailsWithBody, fetchAllSenders } from './inboxFetcher.js';
import { extractChildProfiles } from '../parsers/childProfileExtractor.js';
import { getIncludedSenders, hasSenderFilters } from '../db/senderFilterDb.js';
import { insertFeedbackItemsBatch, clearFeedbackItems } from '../db/relevanceFeedbackDb.js';
import { getUser, getHostedEmailAlias, updateOnboardingStep } from '../db/userDb.js';
import { setTrialStarted, markOnboardingEmailSent } from '../db/trialDb.js';
import {
  updateScanStatus,
  updateJobStatus,
  completeScan,
  completeJob,
  failScan,
  failJob,
} from '../db/onboardingScanDb.js';
import { rankSenderRelevance } from './senderRelevanceRanker.js';

/**
 * Run the inbox scan in the background.
 * Updates scan status as it progresses.
 */
export async function runBackgroundScan(
  scanId: number,
  userId: string,
  auth: any,
  log: any
): Promise<void> {
  try {
    // Update status to scanning
    updateScanStatus(scanId, 'scanning');
    console.log(`[SCAN ${scanId}] Starting - fetching senders`);
    log.info({ scanId, userId }, 'Background scan: fetching senders');

    // Fetch both primary and updates
    const categoryFilter = '{category:primary category:updates}';
    const senders = await fetchAllSenders(auth, 'last30days', categoryFilter, 500);

    console.log(`[SCAN ${scanId}] Fetched ${senders.length} senders`);
    log.info({ scanId, userId, uniqueSenders: senders.length }, 'Background scan: senders fetched');

    // Update status to ranking
    updateScanStatus(scanId, 'ranking');
    console.log(`[SCAN ${scanId}] Starting ranking of ${senders.length} senders`);
    log.info({ scanId, userId }, 'Background scan: ranking senders');

    // Rank senders by AI relevance
    console.log(`[SCAN ${scanId}] Calling rankSenderRelevance...`);
    const rankedSenders = await rankSenderRelevance(senders);
    console.log(`[SCAN ${scanId}] Ranking complete - ${rankedSenders.length} ranked`);

    log.info({ scanId, userId, rankedCount: rankedSenders.length }, 'Background scan: complete');

    // Mark as complete with results
    console.log(`[SCAN ${scanId}] Saving results...`);
    completeScan(scanId, {
      senders: rankedSenders,
      total_emails: rankedSenders.reduce((sum, s) => sum + s.count, 0),
    });
    console.log(`[SCAN ${scanId}] Done!`);
  } catch (error: any) {
    console.error(`[SCAN ${scanId}] ERROR:`, error);
    log.error({ err: error, scanId, userId }, 'Background scan failed');
    failScan(scanId, error.message || 'Unknown error');
  }
}

/**
 * Run extraction for training in the background.
 * Fetches emails from included senders and extracts todos/events for user feedback.
 */
export async function runBackgroundExtraction(
  jobId: number,
  userId: string,
  auth: any,
  includedSenders: string[],
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    log.info({ jobId, userId, senderCount: includedSenders.length }, 'Background extraction: starting');

    // Dynamically import heavy parsers (lazy load to avoid startup cost)
    const { extractEventsAndTodos } = await import('../parsers/eventTodoExtractor.js');

    // Build sender query
    const senderQuery = `{${includedSenders.map(s => `from:${s}`).join(' OR ')}}`;

    // Fetch last 7 days of emails with body (limited to avoid token limits)
    log.info({ jobId, userId }, 'Background extraction: fetching emails');
    const emails = await fetchRecentEmailsWithBody(auth, 'last7days', 30, senderQuery);

    log.info({ jobId, userId, emailCount: emails.length }, 'Background extraction: analyzing emails');

    // Build email lookup map for later
    const emailLookup = new Map<string, { from: string; fromName: string; subject: string }>();
    for (const e of emails) {
      emailLookup.set(e.id, { from: e.from, fromName: e.fromName, subject: e.subject });
    }

    // Convert to format expected by extractEventsAndTodos
    const emailsForExtraction = emails.map(e => ({
      id: e.id,
      from: e.from,
      fromName: e.fromName,
      subject: e.subject,
      snippet: e.snippet,
      receivedAt: e.receivedAt,
      labels: e.labels,
      hasAttachments: e.hasAttachments,
      bodyText: e.body,
    }));

    // Process emails in smaller batches to avoid token limits
    const BATCH_SIZE = 10;
    let allTodos: any[] = [];
    let allEvents: any[] = [];

    for (let i = 0; i < emailsForExtraction.length; i += BATCH_SIZE) {
      const batch = emailsForExtraction.slice(i, i + BATCH_SIZE);
      log.info({ jobId, userId, batch: `${i}-${i + batch.length}` }, 'Background extraction: processing batch');

      try {
        const extracted = await extractEventsAndTodos(batch, 'openai');
        allTodos = allTodos.concat(extracted.todos);
        allEvents = allEvents.concat(extracted.events);
      } catch (batchErr: any) {
        log.warn({ jobId, userId, err: batchErr.message }, 'Background extraction: batch failed, continuing');
      }
    }

    log.info({ jobId, userId, todosFound: allTodos.length, eventsFound: allEvents.length }, 'Background extraction: items extracted');

    // Build items for feedback
    const items: Array<{
      type: 'todo' | 'event';
      item_text: string;
      source_sender: string;
      source_subject: string;
    }> = [];

    // Map extracted items back to source emails for sender info
    for (const todo of allTodos) {
      const sourceEmail = todo.source_email_id ? emailLookup.get(todo.source_email_id) : null;
      items.push({
        type: 'todo',
        item_text: todo.description,
        source_sender: sourceEmail ? (sourceEmail.fromName || sourceEmail.from) : 'Unknown',
        source_subject: sourceEmail?.subject || '',
      });
    }

    for (const event of allEvents) {
      const sourceEmail = event.source_email_id ? emailLookup.get(event.source_email_id) : null;
      items.push({
        type: 'event',
        item_text: event.title,
        source_sender: sourceEmail ? (sourceEmail.fromName || sourceEmail.from) : 'Unknown',
        source_subject: sourceEmail?.subject || '',
      });
    }

    log.info({ jobId, userId, itemCount: items.length }, 'Background extraction: saving items');

    // Clear old items and insert new ones
    clearFeedbackItems(userId);

    if (items.length > 0) {
      const feedbackItems = items.map(item => ({
        user_id: userId,
        item_type: item.type as 'todo' | 'event',
        item_text: item.item_text,
        source_sender: item.source_sender,
        source_subject: item.source_subject,
      }));

      insertFeedbackItemsBatch(feedbackItems);
    }

    log.info({ jobId, userId, itemCount: items.length }, 'Background extraction: complete');

    // Mark as complete
    completeJob(jobId, {
      items,
      emailsProcessed: emails.length,
    });
  } catch (error: any) {
    log.error({ err: error, jobId, userId }, 'Background extraction failed');
    failJob(jobId, error.message || 'Unknown error');
  }
}

/**
 * Run email generation in the background.
 * For hosted path (auth=null): emails already in DB, send via SES.
 * For gmail path (auth set): fetch from Gmail, send via Gmail API.
 */
export async function runBackgroundGenerateEmail(
  jobId: number,
  userId: string,
  auth: any | null,
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    log.info({ jobId, userId, hostedPath: auth === null }, 'Background email generation: starting');

    // Dynamically import heavy modules (lazy load)
    const { analyzeUnanalyzedEmails } = await import('../parsers/twoPassAnalyzer.js');
    const { generatePersonalizedSummary } = await import('../utils/personalizedSummaryBuilder.js');
    const { createActionToken } = await import('../db/emailActionTokenDb.js');
    const { getOrCreateDefaultSettings } = await import('../db/settingsDb.js');

    // Step 1: Fetch and store emails (Gmail path only; hosted emails already in DB)
    if (auth !== null) {
      const { fetchAndStoreEmails } = await import('../utils/emailStorageService.js');
      let senderQuery = '';
      if (hasSenderFilters(userId)) {
        const senders = getIncludedSenders(userId);
        if (senders.length > 0) {
          senderQuery = `{${senders.map(s => `from:${s}`).join(' OR ')}}`;
        }
      }

      log.info({ jobId, userId, hasSenderFilter: !!senderQuery }, 'Background email: fetching emails from Gmail');
      const fetchResult = await fetchAndStoreEmails(userId, auth, 'last7days', 200, senderQuery);
      log.info({ jobId, userId, fetched: fetchResult.fetched, stored: fetchResult.stored }, 'Background email: emails fetched');
    } else {
      log.info({ jobId, userId }, 'Background email: hosted path — skipping Gmail fetch, emails already in DB');
    }

    // Step 2: Analyze all unanalyzed emails
    updateJobStatus(jobId, 'ranking');
    log.info({ jobId, userId }, 'Background email: analyzing emails');
    const analysisResult = await analyzeUnanalyzedEmails(userId, 'openai', 50);
    log.info({ jobId, userId, processed: analysisResult.processed }, 'Background email: analysis complete');

    // Step 3: Generate summary
    updateJobStatus(jobId, 'ranking');
    log.info({ jobId, userId }, 'Background email: generating summary');
    const summary = await generatePersonalizedSummary(userId, 7);

    // Add action URLs
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    const addTodoAction = (todo: any) => {
      const token = createActionToken(userId, 'complete_todo', todo.id);
      return { ...todo, actionUrl: `${baseUrl}/api/action/${token}` };
    };
    const addEventAction = (event: any) => {
      if (event.id) {
        const token = createActionToken(userId, 'remove_event', event.id);
        return { ...event, actionUrl: `${baseUrl}/api/action/${token}` };
      }
      return { ...event };
    };

    const summaryWithActions = {
      generated_at: summary.generated_at,
      date_range: summary.date_range,
      by_child: summary.by_child.map(child => ({
        child_name: child.child_name,
        display_name: child.display_name,
        today_todos: child.today_todos.map(addTodoAction),
        today_events: child.today_events.map(addEventAction),
        upcoming_todos: child.upcoming_todos.map(addTodoAction),
        upcoming_events: child.upcoming_events.map(addEventAction),
        insights: child.insights,
      })),
      family_wide: {
        today_todos: summary.family_wide.today_todos.map(addTodoAction),
        today_events: summary.family_wide.today_events.map(addEventAction),
        upcoming_todos: summary.family_wide.upcoming_todos.map(addTodoAction),
        upcoming_events: summary.family_wide.upcoming_events.map(addEventAction),
        insights: summary.family_wide.insights,
      },
      insights: summary.insights,
      highlight: summary.highlight,
      emailsAnalyzed: summary.emailsAnalyzed,
    };

    // Render the standard Family Briefing email
    const { renderPersonalizedEmail } = await import('../templates/personalizedEmailTemplate.js');
    const { buildSummarySubject } = await import('../utils/emailSender.js');
    const html = renderPersonalizedEmail(summaryWithActions);
    const subject = buildSummarySubject();

    // Send to user's email
    const settings = getOrCreateDefaultSettings(userId);
    const recipients = settings.summary_email_recipients.length > 0
      ? settings.summary_email_recipients
      : [getUser(userId)?.email].filter(Boolean) as string[];

    if (auth !== null) {
      // Gmail path: send via Gmail API
      const { sendInboxSummary } = await import('../utils/emailSender.js');
      const dummySummary = {
        email_analysis: { total_received: 0, signal_count: 0, noise_count: 0 },
        summary: [], kit_list: { tomorrow: [], upcoming: [] },
        financials: [], calendar_updates: [],
        attachments_requiring_review: [], recurring_activities: [],
        pro_dad_insight: '',
      };
      await sendInboxSummary(auth, dummySummary, html, recipients);
    } else {
      // Hosted path: send via SES
      const { sendViaSES, buildSesFromAddress } = await import('../utils/emailSender.js');
      const alias = getHostedEmailAlias(userId);
      const fromAddress = buildSesFromAddress(alias);
      await sendViaSES(html, recipients, fromAddress, subject);
    }

    log.info({ jobId, userId, recipients }, 'Background email: first briefing sent successfully');

    // Mark onboarding complete and start trial
    updateOnboardingStep(userId, 5);
    setTrialStarted(userId);
    markOnboardingEmailSent(userId, 1, 'welcome');
    log.info({ jobId, userId }, 'Day 1 briefing email sent, trial started');

    // Mark as complete
    completeJob(jobId, {
      sent: true,
      recipients,
      emailsAnalyzed: summary.emailsAnalyzed,
    });
  } catch (error: any) {
    log.error({ err: error, jobId, userId }, 'Background email generation failed');
    failJob(jobId, error.message || 'Unknown error');
  }
}

/**
 * Run analysis of already-stored hosted emails in the background.
 * No Gmail fetch needed — emails are already in the DB from inbound SES webhook.
 */
export async function runBackgroundProcessHosted(
  jobId: number,
  userId: string,
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    log.info({ jobId, userId }, 'Background process-hosted: counting emails');

    // Do NOT run AI analysis here — child profiles haven't been set yet.
    // Analysis runs in runBackgroundGenerateEmail (step 5) after profiles are confirmed,
    // so events/todos are extracted with correct child associations.
    const { default: db } = await import('../db/db.js');
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM emails WHERE user_id = ? AND source_type = 'hosted'`
    ).get(userId) as { count: number };
    const emailCount = row?.count ?? 0;

    log.info({ jobId, userId, emailCount }, 'Background process-hosted: emails ready');

    completeJob(jobId, { emailCount });
  } catch (error: any) {
    log.error({ err: error, jobId, userId }, 'Background process-hosted failed');
    failJob(jobId, error.message || 'Unknown error');
  }
}

/**
 * Run child profile analysis in the background.
 * For gmail path: fetches emails from Gmail then extracts.
 * For hosted path (auth=null): loads already-stored emails from DB.
 */
export async function runBackgroundAnalysis(
  jobId: number,
  userId: string,
  auth: any | null,
  provider: 'openai' | 'anthropic',
  schoolContext: Array<{ name: string; year_groups: string[] }> | undefined,
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    console.log(`[ANALYZE ${jobId}] Starting - ${auth ? 'fetching from Gmail' : 'loading from DB'}`);
    log.info({ jobId, userId, provider, hostedPath: auth === null }, 'Background analysis: starting');

    let emails: Array<any> = [];

    if (auth !== null) {
      // Gmail path: fetch from Gmail
      const includedSenders = getIncludedSenders(userId);
      let senderQuery = '';
      if (includedSenders.length > 0) {
        senderQuery = includedSenders.map(s => `from:${s}`).join(' OR ');
        senderQuery = `{${senderQuery}}`;
      }

      log.info({ jobId, userId, senderCount: includedSenders.length }, 'Background analysis: fetching emails from Gmail');
      const rawEmails = await fetchRecentEmailsWithBody(auth, 'last30days', 50, senderQuery);
      console.log(`[ANALYZE ${jobId}] Fetched ${rawEmails.length} emails from Gmail`);

      emails = rawEmails.map(e => ({
        ...e,
        bodyText: e.body,
      }));
    } else {
      // Hosted path: load from DB
      const { default: db } = await import('../db/db.js');
      const rows = db.prepare(`
        SELECT id, from_email, from_name, subject, date, body_text, snippet, labels, attachment_content
        FROM emails
        WHERE user_id = ? AND source_type = 'hosted'
        ORDER BY date DESC
        LIMIT 50
      `).all(userId) as any[];

      console.log(`[ANALYZE ${jobId}] Loaded ${rows.length} hosted emails from DB`);
      log.info({ jobId, userId, emailCount: rows.length }, 'Background analysis: loaded hosted emails from DB');

      emails = rows.map(r => ({
        id: String(r.id),
        from: r.from_email,
        fromName: r.from_name || '',
        subject: r.subject || '',
        snippet: r.snippet || '',
        receivedAt: r.date,
        labels: r.labels ? JSON.parse(r.labels) : [],
        hasAttachments: false,
        bodyText: r.body_text || r.attachment_content || '',
        body: r.body_text || r.attachment_content || '',
      }));
    }

    if (emails.length === 0) {
      completeJob(jobId, {
        children: [],
        schools_detected: [],
        email_count_analyzed: 0,
        date_range: {
          from: new Date().toISOString(),
          to: new Date().toISOString(),
        },
      });
      return;
    }

    // Update status to ranking (analysis phase)
    updateJobStatus(jobId, 'ranking');
    console.log(`[ANALYZE ${jobId}] Analyzing ${emails.length} emails with ${provider}`);
    log.info({ jobId, userId }, 'Background analysis: extracting child profiles');

    // Extract child profiles using AI
    const result = await extractChildProfiles(emails, provider, schoolContext);

    console.log(`[ANALYZE ${jobId}] Found ${result.children.length} children, ${result.schools_detected.length} schools`);
    log.info({
      jobId,
      userId,
      childrenFound: result.children.length,
      schoolsFound: result.schools_detected.length,
    }, 'Background analysis: complete');

    // Mark as complete
    completeJob(jobId, result);
    console.log(`[ANALYZE ${jobId}] Done!`);
  } catch (error: any) {
    console.error(`[ANALYZE ${jobId}] ERROR:`, error);
    log.error({ err: error, jobId, userId }, 'Background analysis failed');
    failJob(jobId, error.message || 'Unknown error');
  }
}
