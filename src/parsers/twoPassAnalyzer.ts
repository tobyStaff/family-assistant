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
import { extractEventsAndTodosEnhanced } from './eventTodoExtractor.js';
import type { EmailMetadata } from '../types/summary.js';
import type { EnhancedExtractionResult } from './extractionSchema.js';

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

    // Convert to EmailMetadata
    const emailMetadata = storedEmailToMetadata(email);

    // Run AI extraction
    console.log(`[TwoPass] Analyzing email ${emailId}: "${email.subject}"`);
    const extraction = await extractEventsAndTodosEnhanced([emailMetadata], aiProvider);

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
        const todoInput: CreateTodoInput = {
          description: todo.description,
          type: todo.type,
          due_date: todo.due_date || undefined,
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

  return result;
}

/**
 * Re-analyze a specific email (creates new analysis version)
 */
export async function reanalyzeEmail(
  userId: string,
  emailId: number,
  aiProvider: 'openai' | 'anthropic' = 'openai'
): Promise<TwoPassAnalysisResult> {
  // Reset the email's analyzed flag
  const { default: db } = await import('../db/db.js');
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
