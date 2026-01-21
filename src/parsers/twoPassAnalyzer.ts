// src/parsers/twoPassAnalyzer.ts

import { getEmailById, listEmails, markEmailAnalyzed, type StoredEmail } from '../db/emailDb.js';
import {
  createEmailAnalysis,
  getAnalysisByEmailId,
  getUnanalyzedEmailIds,
  type CreateEmailAnalysisInput,
} from '../db/emailAnalysisDb.js';
import { createTodoEnhanced, type CreateTodoInput } from '../db/todoDb.js';
import { createEvent, type CreateEventInput } from '../db/eventDb.js';
import { getChildProfiles } from '../db/childProfilesDb.js';
import { extractEventsAndTodosEnhanced } from './eventTodoExtractor.js';
import type { EmailMetadata } from '../types/summary.js';
import type { EnhancedExtractionResult } from './extractionSchema.js';
import {
  createChildMappings,
  getAnonymizedProfiles,
  anonymizeText,
  deanonymizeExtractionResult,
  type ChildMapping,
} from '../utils/childAnonymizer.js';
import { cleanupPastItems } from '../utils/cleanupPastItems.js';

/**
 * Check if a string is a valid ISO8601 date
 */
function isValidISODate(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Day name to day number mapping (Sunday = 0)
 */
const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Extract day number from recurrence pattern
 * Returns the first day found, or null if no day found
 */
function extractDayFromPattern(pattern: string | null | undefined): number | null {
  if (!pattern) return null;
  const lowerPattern = pattern.toLowerCase();

  for (const [dayName, dayNum] of Object.entries(DAY_NAMES)) {
    if (lowerPattern.includes(dayName)) {
      return dayNum;
    }
  }
  return null;
}

/**
 * Calculate the next occurrence of a given day from a reference date
 */
function getNextOccurrence(referenceDate: Date, targetDay: number): Date {
  const result = new Date(referenceDate);
  const currentDay = result.getDay();

  // Calculate days until target day
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7; // Move to next week if target is today or earlier
  }

  result.setDate(result.getDate() + daysUntil);
  result.setHours(9, 0, 0, 0); // Default to 9:00 AM
  return result;
}

/**
 * Validate and fix a due date for a todo item
 * If the date is invalid but we have a recurrence pattern with a day name,
 * calculate the next occurrence from the email date
 */
function validateAndFixDueDate(
  dueDate: string | null | undefined,
  recurrencePattern: string | null | undefined,
  emailDate: Date
): string | undefined {
  // If due date is valid, return it
  if (isValidISODate(dueDate)) {
    return dueDate!;
  }

  // If no recurrence pattern, can't fix it
  if (!recurrencePattern) {
    return undefined;
  }

  // Try to extract a day from the recurrence pattern
  const targetDay = extractDayFromPattern(recurrencePattern);
  if (targetDay === null) {
    return undefined;
  }

  // Calculate the next occurrence
  const nextOccurrence = getNextOccurrence(emailDate, targetDay);
  console.log(`[TwoPass] Fixed invalid date using recurrence pattern "${recurrencePattern}" → ${nextOccurrence.toISOString()}`);
  return nextOccurrence.toISOString();
}

/**
 * Result of two-pass analysis
 */
export interface TwoPassAnalysisResult {
  emailId: number;
  analysisId: number;
  eventsCreated: number;
  todosCreated: number;
  qualityScore: number;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Batch analysis result
 */
export interface BatchAnalysisResult {
  processed: number;
  successful: number;
  failed: number;
  eventsCreated: number;
  todosCreated: number;
  results: TwoPassAnalysisResult[];
  errors: string[];
}

/**
 * Calculate quality score based on extraction results
 * Score ranges from 0.0 to 1.0
 */
function calculateQualityScore(result: EnhancedExtractionResult): number {
  let score = 0.5; // Base score

  // Factor 1: Confidence scores of extracted items
  const allConfidences: number[] = [
    ...result.events.map((e: any) => e.confidence || 0),
    ...result.todos.map((t: any) => t.confidence || 0),
  ];

  if (allConfidences.length > 0) {
    const avgConfidence = allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length;
    score += avgConfidence * 0.3; // Up to 0.3 bonus
  }

  // Factor 2: Human analysis completeness
  if (result.human_analysis) {
    if (result.human_analysis.email_summary) score += 0.05;
    if (result.human_analysis.email_tone) score += 0.05;
    if (result.human_analysis.email_intent) score += 0.05;
    if (result.human_analysis.implicit_context) score += 0.05;
  }

  // Factor 3: Penalize too many inferred items (might be over-inference)
  const inferredCount = [
    ...result.events.filter((e: any) => e.inferred_date),
    ...result.todos.filter((t: any) => t.inferred),
  ].length;

  const totalItems = result.events.length + result.todos.length;
  if (totalItems > 0) {
    const inferredRatio = inferredCount / totalItems;
    if (inferredRatio > 0.7) {
      score -= 0.1; // Penalize if more than 70% are inferred
    }
  }

  return Math.max(0, Math.min(1, score)); // Clamp to 0-1
}

/**
 * Convert stored email to EmailMetadata format for extraction
 */
function storedEmailToMetadata(email: StoredEmail): EmailMetadata {
  return {
    id: email.gmail_message_id,
    from: email.from_email,
    fromName: email.from_name || email.from_email,
    subject: email.subject,
    snippet: email.snippet || '',
    receivedAt: email.date.toISOString(),
    labels: email.labels || [],
    hasAttachments: email.has_attachments,
    bodyText: email.body_text || '',
    attachmentContent: email.attachment_content,
  };
}

/**
 * Analyze a single email (Pass 1: AI extraction)
 */
export async function analyzeEmail(
  userId: string,
  emailId: number,
  aiProvider: 'openai' | 'anthropic' = 'openai'
): Promise<TwoPassAnalysisResult> {
  try {
    // Check if already analyzed
    const existingAnalysis = getAnalysisByEmailId(userId, emailId);
    if (existingAnalysis) {
      return {
        emailId,
        analysisId: existingAnalysis.id,
        eventsCreated: existingAnalysis.events_extracted,
        todosCreated: existingAnalysis.todos_extracted,
        qualityScore: existingAnalysis.quality_score || 0,
        status: 'success',
      };
    }

    // Get the email
    const email = getEmailById(userId, emailId);
    if (!email) {
      return {
        emailId,
        analysisId: 0,
        eventsCreated: 0,
        todosCreated: 0,
        qualityScore: 0,
        status: 'error',
        error: 'Email not found',
      };
    }

    // Fetch child profiles for relevance filtering
    const childProfiles = getChildProfiles(userId, true); // Only active profiles
    const mappings = createChildMappings(childProfiles);
    const anonymizedProfiles = getAnonymizedProfiles(mappings);

    // Convert to EmailMetadata with anonymized content
    const emailMetadata = storedEmailToMetadata(email);

    // Anonymize email content before sending to AI
    if (mappings.length > 0) {
      emailMetadata.subject = anonymizeText(emailMetadata.subject, mappings);
      emailMetadata.snippet = anonymizeText(emailMetadata.snippet, mappings);
      if (emailMetadata.bodyText) {
        emailMetadata.bodyText = anonymizeText(emailMetadata.bodyText, mappings);
      }
      if (emailMetadata.attachmentContent) {
        emailMetadata.attachmentContent = anonymizeText(emailMetadata.attachmentContent, mappings);
      }
    }

    // Run AI extraction with anonymized profiles for relevance filtering
    console.log(`[TwoPass] Analyzing email ${emailId}: "${email.subject}" (${mappings.length} child profiles)`);
    let extraction = await extractEventsAndTodosEnhanced([emailMetadata], aiProvider, anonymizedProfiles);

    // Deanonymize the extraction result (replace CHILD_1, CHILD_2 with real names)
    if (mappings.length > 0) {
      extraction = deanonymizeExtractionResult(extraction, mappings);
    }

    // Calculate quality score
    const qualityScore = calculateQualityScore(extraction);

    // Calculate average confidence
    const allConfidences = [
      ...extraction.events.map((e: any) => e.confidence || 0),
      ...extraction.todos.map((t: any) => t.confidence || 0),
    ];
    const confidenceAvg = allConfidences.length > 0
      ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
      : null;

    // Count recurring and inferred items
    const recurringItems = [
      ...extraction.events.filter((e: any) => e.recurring),
      ...extraction.todos.filter((t: any) => t.recurring),
    ].length;

    const inferredItems = [
      ...extraction.events.filter((e: any) => e.inferred_date),
      ...extraction.todos.filter((t: any) => t.inferred),
    ].length;

    // Create analysis record
    const analysisInput: CreateEmailAnalysisInput = {
      email_id: emailId,
      ai_provider: aiProvider,
      human_analysis: extraction.human_analysis,
      raw_extraction_json: JSON.stringify(extraction),
      quality_score: qualityScore,
      confidence_avg: confidenceAvg,
      events_extracted: extraction.events.length,
      todos_extracted: extraction.todos.length,
      recurring_items: recurringItems,
      inferred_items: inferredItems,
    };

    const analysisId = createEmailAnalysis(userId, analysisInput);

    // Pass 2: Create events and todos in database
    let eventsCreated = 0;
    let todosCreated = 0;

    // Create events
    for (const event of extraction.events) {
      try {
        const eventInput: CreateEventInput = {
          title: event.title,
          date: event.date,
          end_date: event.end_date || undefined,
          description: event.description || undefined,
          location: event.location || undefined,
          child_name: event.child_name || 'General',
          source_email_id: email.gmail_message_id,
          confidence: event.confidence,
          recurring: event.recurring,
          recurrence_pattern: event.recurrence_pattern || undefined,
          time_of_day: event.time_of_day,
          inferred_date: event.inferred_date,
        };

        createEvent(userId, eventInput);
        eventsCreated++;
      } catch (err: any) {
        console.error(`[TwoPass] Error creating event:`, err.message);
      }
    }

    // Create todos
    for (const todo of extraction.todos) {
      try {
        // Validate and fix due_date if invalid (especially for recurring items)
        const fixedDueDate = validateAndFixDueDate(
          todo.due_date,
          todo.recurrence_pattern,
          email.date
        );

        const todoInput: CreateTodoInput = {
          description: todo.description,
          type: todo.type,
          due_date: fixedDueDate,
          child_name: todo.child_name || 'General',
          source_email_id: email.gmail_message_id,
          url: todo.url || undefined,
          amount: todo.amount || undefined,
          confidence: todo.confidence,
          recurring: todo.recurring,
          recurrence_pattern: todo.recurrence_pattern || undefined,
          responsible_party: todo.responsible_party || undefined,
          inferred: todo.inferred,
        };

        createTodoEnhanced(userId, todoInput);
        todosCreated++;

        // Auto-create reminder events for PACK todos
        if (todo.type === 'PACK' && fixedDueDate) {
          const dueDateTime = new Date(fixedDueDate);

          // Event 1: Evening prep (7pm day before)
          const eveningDate = new Date(dueDateTime);
          eveningDate.setDate(eveningDate.getDate() - 1);
          eveningDate.setHours(19, 0, 0, 0);

          const eveningEventInput: CreateEventInput = {
            title: `Prep: ${todo.description}`,
            date: eveningDate.toISOString(),
            child_name: todo.child_name || 'General',
            source_email_id: email.gmail_message_id,
            confidence: todo.confidence,
            recurring: todo.recurring,
            recurrence_pattern: todo.recurrence_pattern || undefined,
          };
          createEvent(userId, eveningEventInput);
          eventsCreated++;

          // Event 2: Morning reminder (7am day of)
          const morningDate = new Date(dueDateTime);
          morningDate.setHours(7, 0, 0, 0);

          const morningEventInput: CreateEventInput = {
            title: `Pack: ${todo.description}`,
            date: morningDate.toISOString(),
            child_name: todo.child_name || 'General',
            source_email_id: email.gmail_message_id,
            confidence: todo.confidence,
            recurring: todo.recurring,
            recurrence_pattern: todo.recurrence_pattern || undefined,
          };
          createEvent(userId, morningEventInput);
          eventsCreated++;

          console.log(`[TwoPass] Created PACK reminder events for "${todo.description}"`);
        }
      } catch (err: any) {
        console.error(`[TwoPass] Error creating todo:`, err.message);
      }
    }

    // Mark email as analyzed
    markEmailAnalyzed(userId, emailId);

    console.log(`[TwoPass] Analysis complete: ${eventsCreated} events, ${todosCreated} todos, quality: ${qualityScore.toFixed(2)}`);

    return {
      emailId,
      analysisId,
      eventsCreated,
      todosCreated,
      qualityScore,
      status: 'success',
    };
  } catch (error: any) {
    console.error(`[TwoPass] Error analyzing email ${emailId}:`, error.message);

    return {
      emailId,
      analysisId: 0,
      eventsCreated: 0,
      todosCreated: 0,
      qualityScore: 0,
      status: 'error',
      error: error.message,
    };
  }
}

/**
 * Batch analyze unanalyzed emails
 */
export async function analyzeUnanalyzedEmails(
  userId: string,
  aiProvider: 'openai' | 'anthropic' = 'openai',
  limit: number = 50
): Promise<BatchAnalysisResult> {
  const result: BatchAnalysisResult = {
    processed: 0,
    successful: 0,
    failed: 0,
    eventsCreated: 0,
    todosCreated: 0,
    results: [],
    errors: [],
  };

  // Get unanalyzed email IDs
  const emailIds = getUnanalyzedEmailIds(userId, limit);

  if (emailIds.length === 0) {
    console.log('[TwoPass] No unanalyzed emails found');
    return result;
  }

  console.log(`[TwoPass] Starting batch analysis of ${emailIds.length} emails`);

  for (const emailId of emailIds) {
    result.processed++;

    const analysisResult = await analyzeEmail(userId, emailId, aiProvider);
    result.results.push(analysisResult);

    if (analysisResult.status === 'success') {
      result.successful++;
      result.eventsCreated += analysisResult.eventsCreated;
      result.todosCreated += analysisResult.todosCreated;
    } else {
      result.failed++;
      if (analysisResult.error) {
        result.errors.push(`Email ${emailId}: ${analysisResult.error}`);
      }
    }

    // Small delay between API calls to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`[TwoPass] Batch analysis complete: ${result.successful}/${result.processed} successful`);
  console.log(`[TwoPass] Created ${result.eventsCreated} events, ${result.todosCreated} todos`);

  // Clean up past items (>24h old) after analysis, before calendar sync
  // This filters out any old events/todos that were just created from old emails
  const cleanup = cleanupPastItems(userId);
  if (cleanup.todosCompleted > 0 || cleanup.eventsRemoved > 0) {
    console.log(`[TwoPass] Cleanup: auto-completed ${cleanup.todosCompleted} todos, removed ${cleanup.eventsRemoved} events (cutoff: ${cleanup.cutoffDate.toISOString()})`);
  }

  return result;
}

/**
 * Re-analyze a specific email (deletes existing analysis and creates new one)
 */
export async function reanalyzeEmail(
  userId: string,
  emailId: number,
  aiProvider: 'openai' | 'anthropic' = 'openai'
): Promise<TwoPassAnalysisResult> {
  const { default: db } = await import('../db/db.js');

  // Delete existing analysis for this email
  db.prepare(`
    DELETE FROM email_analyses
    WHERE user_id = ? AND email_id = ?
  `).run(userId, emailId);

  // Reset the email's analyzed flag
  db.prepare(`
    UPDATE emails
    SET analyzed = 0, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND id = ?
  `).run(userId, emailId);

  // Run analysis again
  return analyzeEmail(userId, emailId, aiProvider);
}

/**
 * Get analysis summary for display
 */
export async function getAnalysisSummary(
  userId: string
): Promise<{
  pendingAnalysis: number;
  analyzedToday: number;
  lowQualityCount: number;
}> {
  const { default: db } = await import('../db/db.js');

  const pending = db.prepare(`
    SELECT COUNT(*) as count
    FROM emails e
    LEFT JOIN email_analyses ea ON e.id = ea.email_id AND e.user_id = ea.user_id
    WHERE e.user_id = ? AND e.processed = 1 AND ea.id IS NULL
  `).get(userId) as { count: number };

  const today = new Date().toISOString().split('T')[0];
  const analyzedToday = db.prepare(`
    SELECT COUNT(*) as count
    FROM email_analyses
    WHERE user_id = ? AND DATE(created_at) = ?
  `).get(userId, today) as { count: number };

  const lowQuality = db.prepare(`
    SELECT COUNT(*) as count
    FROM email_analyses
    WHERE user_id = ? AND status = 'analyzed' AND quality_score < 0.7
  `).get(userId) as { count: number };

  return {
    pendingAnalysis: pending.count,
    analyzedToday: analyzedToday.count,
    lowQualityCount: lowQuality.count,
  };
}
