// src/routes/emailRoutes.ts

import type { FastifyInstance } from 'fastify';
import {
  listEmails,
  getEmailById,
  getEmailStats,
  getUnanalyzedEmails,
  deleteEmail,
  type StoredEmail,
} from '../db/emailDb.js';
import {
  listEmailAnalyses,
  getEmailAnalysisById,
  getAnalysisStats,
  updateAnalysisStatus,
  batchApproveAnalyses,
  deleteEmailAnalysis,
  type StoredEmailAnalysis,
  type AnalysisStatus,
} from '../db/emailAnalysisDb.js';
import { analyzeEmail, analyzeUnanalyzedEmails, reanalyzeEmail } from '../parsers/twoPassAnalyzer.js';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { fetchAndStoreEmails, syncProcessedLabels } from '../utils/emailStorageService.js';
import type { DateRange } from '../utils/inboxFetcher.js';

/**
 * Register email routes
 */
export async function emailRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/emails
   * List all emails for the authenticated user (JSON API)
   */
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      processed?: string;
      analyzed?: string;
    };
  }>('/api/emails', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const limit = parseInt(request.query.limit || '50');
      const offset = parseInt(request.query.offset || '0');

      const emails = listEmails(userId, limit, offset);
      const stats = getEmailStats(userId);

      return reply.code(200).send({
        emails: emails.map(formatEmailForApi),
        stats,
        count: emails.length,
        pagination: { limit, offset },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error listing emails');
      return reply.code(500).send({ error: 'Failed to fetch emails' });
    }
  });

  /**
   * GET /api/emails/:id
   * Get a single email by ID (JSON API)
   */
  fastify.get<{ Params: { id: string } }>('/api/emails/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const emailId = parseInt(request.params.id);

    if (isNaN(emailId)) {
      return reply.code(400).send({ error: 'Invalid email ID' });
    }

    try {
      const email = getEmailById(userId, emailId);

      if (!email) {
        return reply.code(404).send({ error: 'Email not found' });
      }

      return reply.code(200).send({ email: formatEmailForApi(email) });
    } catch (error: any) {
      fastify.log.error({ err: error, userId, emailId }, 'Error fetching email');
      return reply.code(500).send({ error: 'Failed to fetch email' });
    }
  });

  /**
   * POST /api/emails/fetch
   * Manually trigger email fetch from Gmail
   */
  fastify.post<{
    Body: {
      dateRange?: string;
      maxResults?: number;
    };
  }>('/api/emails/fetch', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      const dateRange = (request.body?.dateRange || 'last3days') as DateRange;
      const maxResults = request.body?.maxResults || 100;

      fastify.log.info({ userId, dateRange, maxResults }, 'Manual email fetch triggered');

      const result = await fetchAndStoreEmails(userId, auth, dateRange, maxResults);

      // Also sync any pending labels
      const labelSync = await syncProcessedLabels(userId, auth);

      return reply.code(200).send({
        success: true,
        ...result,
        labelSync,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching emails');
      return reply.code(500).send({ error: 'Failed to fetch emails', message: error.message });
    }
  });

  /**
   * DELETE /api/emails/:id
   * Delete an email from the database
   */
  fastify.delete<{ Params: { id: string } }>('/api/emails/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const emailId = parseInt(request.params.id);

    if (isNaN(emailId)) {
      return reply.code(400).send({ error: 'Invalid email ID' });
    }

    try {
      const deleted = deleteEmail(userId, emailId);

      if (!deleted) {
        return reply.code(404).send({ error: 'Email not found' });
      }

      return reply.code(200).send({
        success: true,
        message: 'Email deleted successfully',
      });
    } catch (error: any) {
      fastify.log.error({ err: error, userId, emailId }, 'Error deleting email');
      return reply.code(500).send({ error: 'Failed to delete email' });
    }
  });

  /**
   * GET /api/emails/stats
   * Get email statistics
   */
  fastify.get('/api/emails/stats', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const stats = getEmailStats(userId);
      const unanalyzed = getUnanalyzedEmails(userId);

      return reply.code(200).send({
        stats,
        unanalyzedCount: unanalyzed.length,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching email stats');
      return reply.code(500).send({ error: 'Failed to fetch email stats' });
    }
  });

  /**
   * GET /emails-view
   * HTML view for viewing stored emails
   */
  fastify.get('/emails-view', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    try {
      const emails = listEmails(userId, 100, 0);
      const stats = getEmailStats(userId);

      const html = generateEmailsViewHtml(emails, stats);
      return reply.code(200).type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error rendering emails view');
      return reply.code(500).send({ error: 'Failed to load emails view' });
    }
  });

  // ============ EMAIL ANALYSIS ROUTES (Task 2) ============

  /**
   * GET /api/analyses
   * List email analyses for the authenticated user
   */
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      status?: string;
    };
  }>('/api/analyses', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const limit = parseInt(request.query.limit || '50');
      const offset = parseInt(request.query.offset || '0');
      const status = request.query.status as AnalysisStatus | undefined;

      const analyses = listEmailAnalyses(userId, limit, offset, status);
      const stats = getAnalysisStats(userId);

      return reply.code(200).send({
        analyses: analyses.map(formatAnalysisForApi),
        stats,
        count: analyses.length,
        pagination: { limit, offset },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error listing analyses');
      return reply.code(500).send({ error: 'Failed to fetch analyses' });
    }
  });

  /**
   * GET /api/analyses/:id
   * Get a single analysis by ID
   */
  fastify.get<{ Params: { id: string } }>('/api/analyses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const analysisId = parseInt(request.params.id);

    if (isNaN(analysisId)) {
      return reply.code(400).send({ error: 'Invalid analysis ID' });
    }

    try {
      const analysis = getEmailAnalysisById(userId, analysisId);

      if (!analysis) {
        return reply.code(404).send({ error: 'Analysis not found' });
      }

      return reply.code(200).send({ analysis: formatAnalysisForApi(analysis) });
    } catch (error: any) {
      fastify.log.error({ err: error, analysisId }, 'Error fetching analysis');
      return reply.code(500).send({ error: 'Failed to fetch analysis' });
    }
  });

  /**
   * POST /api/analyses/:id/approve
   * Approve an analysis
   */
  fastify.post<{ Params: { id: string } }>('/api/analyses/:id/approve', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const analysisId = parseInt(request.params.id);

    if (isNaN(analysisId)) {
      return reply.code(400).send({ error: 'Invalid analysis ID' });
    }

    try {
      const updated = updateAnalysisStatus(userId, analysisId, 'approved', userId);

      if (!updated) {
        return reply.code(404).send({ error: 'Analysis not found' });
      }

      return reply.code(200).send({
        success: true,
        message: 'Analysis approved',
      });
    } catch (error: any) {
      fastify.log.error({ err: error, analysisId }, 'Error approving analysis');
      return reply.code(500).send({ error: 'Failed to approve analysis' });
    }
  });

  /**
   * POST /api/analyses/:id/reject
   * Reject an analysis
   */
  fastify.post<{
    Params: { id: string };
    Body: { notes?: string };
  }>('/api/analyses/:id/reject', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const analysisId = parseInt(request.params.id);

    if (isNaN(analysisId)) {
      return reply.code(400).send({ error: 'Invalid analysis ID' });
    }

    try {
      const updated = updateAnalysisStatus(userId, analysisId, 'rejected', userId, request.body?.notes);

      if (!updated) {
        return reply.code(404).send({ error: 'Analysis not found' });
      }

      return reply.code(200).send({
        success: true,
        message: 'Analysis rejected',
      });
    } catch (error: any) {
      fastify.log.error({ err: error, analysisId }, 'Error rejecting analysis');
      return reply.code(500).send({ error: 'Failed to reject analysis' });
    }
  });

  /**
   * DELETE /api/analyses/:id
   * Delete an analysis
   */
  fastify.delete<{ Params: { id: string } }>('/api/analyses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const analysisId = parseInt(request.params.id);

    if (isNaN(analysisId)) {
      return reply.code(400).send({ error: 'Invalid analysis ID' });
    }

    try {
      const deleted = deleteEmailAnalysis(userId, analysisId);

      if (!deleted) {
        return reply.code(404).send({ error: 'Analysis not found' });
      }

      return reply.code(200).send({
        success: true,
        message: 'Analysis deleted successfully',
      });
    } catch (error: any) {
      fastify.log.error({ err: error, userId, analysisId }, 'Error deleting analysis');
      return reply.code(500).send({ error: 'Failed to delete analysis' });
    }
  });

  /**
   * POST /api/analyses/:id/reanalyze
   * Re-analyze an email (deletes old analysis, creates new one)
   */
  fastify.post<{
    Params: { id: string };
    Body: { provider?: 'openai' | 'anthropic' };
  }>('/api/analyses/:id/reanalyze', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const analysisId = parseInt(request.params.id);

    if (isNaN(analysisId)) {
      return reply.code(400).send({ error: 'Invalid analysis ID' });
    }

    try {
      // Get the existing analysis to find the email ID
      const existingAnalysis = getEmailAnalysisById(userId, analysisId);
      if (!existingAnalysis) {
        return reply.code(404).send({ error: 'Analysis not found' });
      }

      const provider = request.body?.provider || 'openai';
      fastify.log.info({ userId, analysisId, emailId: existingAnalysis.email_id, provider }, 'Re-analysis triggered');

      const result = await reanalyzeEmail(userId, existingAnalysis.email_id, provider);

      if (result.status === 'error') {
        return reply.code(500).send({
          success: false,
          error: result.error || 'Re-analysis failed',
        });
      }

      // Get the new analysis to return
      const newAnalysis = getEmailAnalysisById(userId, result.analysisId);

      return reply.code(200).send({
        success: true,
        analysis: newAnalysis ? formatAnalysisForApi(newAnalysis) : null,
        eventsCreated: result.eventsCreated,
        todosCreated: result.todosCreated,
        qualityScore: result.qualityScore,
      });
    } catch (error: any) {
      fastify.log.error({ err: error, analysisId }, 'Error re-analyzing');
      return reply.code(500).send({ error: 'Failed to re-analyze', message: error.message });
    }
  });

  /**
   * POST /api/reset-all-data
   * Delete all user data for testing purposes
   */
  fastify.post('/api/reset-all-data', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    try {
      const { default: db } = await import('../db/db.js');

      // Get counts before deletion for reporting
      const emailCount = (db.prepare('SELECT COUNT(*) as count FROM emails WHERE user_id = ?').get(userId) as any).count;
      const analysisCount = (db.prepare('SELECT COUNT(*) as count FROM email_analyses WHERE user_id = ?').get(userId) as any).count;
      const eventCount = (db.prepare('SELECT COUNT(*) as count FROM events WHERE user_id = ?').get(userId) as any).count;
      const todoCount = (db.prepare('SELECT COUNT(*) as count FROM todos WHERE user_id = ?').get(userId) as any).count;

      // Delete in correct order (foreign key constraints)
      db.prepare('DELETE FROM email_analyses WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM todos WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM events WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM emails WHERE user_id = ?').run(userId);

      fastify.log.info({ userId, emailCount, analysisCount, eventCount, todoCount }, 'User data reset');

      return reply.code(200).send({
        success: true,
        deleted: {
          emails: emailCount,
          analyses: analysisCount,
          events: eventCount,
          todos: todoCount,
        },
      });
    } catch (error: any) {
      fastify.log.error({ err: error, userId }, 'Error resetting user data');
      return reply.code(500).send({ error: 'Failed to reset data', message: error.message });
    }
  });

  /**
   * POST /api/analyses/run
   * Manually trigger analysis on unanalyzed emails
   */
  fastify.post<{
    Body: { limit?: number; provider?: 'openai' | 'anthropic' };
  }>('/api/analyses/run', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const limit = request.body?.limit || 20;
      const provider = request.body?.provider || 'openai';

      fastify.log.info({ userId, limit, provider }, 'Manual analysis triggered');

      const result = await analyzeUnanalyzedEmails(userId, provider, limit);

      return reply.code(200).send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error running analysis');
      return reply.code(500).send({ error: 'Failed to run analysis', message: error.message });
    }
  });

  /**
   * GET /api/analyses/stats
   * Get analysis statistics
   */
  fastify.get('/api/analyses/stats', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const stats = getAnalysisStats(userId);

      return reply.code(200).send({ stats });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching analysis stats');
      return reply.code(500).send({ error: 'Failed to fetch analysis stats' });
    }
  });

  /**
   * GET /analyses-view
   * HTML view for viewing email analyses
   */
  fastify.get('/analyses-view', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    try {
      const analyses = listEmailAnalyses(userId, 100, 0);
      const stats = getAnalysisStats(userId);

      // Fetch emails to get body text for raw email display
      const emailIds = [...new Set(analyses.map((a) => a.email_id))];
      const emailMap = new Map<number, StoredEmail>();
      for (const emailId of emailIds) {
        const email = getEmailById(userId, emailId);
        if (email) {
          emailMap.set(emailId, email);
        }
      }

      const html = generateAnalysesViewHtml(analyses, stats, emailMap);
      return reply.code(200).type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error rendering analyses view');
      return reply.code(500).send({ error: 'Failed to load analyses view' });
    }
  });
}

/**
 * Format analysis for API response
 */
function formatAnalysisForApi(analysis: StoredEmailAnalysis) {
  return {
    id: analysis.id,
    emailId: analysis.email_id,
    analysisVersion: analysis.analysis_version,
    aiProvider: analysis.ai_provider,
    emailSummary: analysis.email_summary,
    emailTone: analysis.email_tone,
    emailIntent: analysis.email_intent,
    implicitContext: analysis.implicit_context,
    qualityScore: analysis.quality_score,
    confidenceAvg: analysis.confidence_avg,
    eventsExtracted: analysis.events_extracted,
    todosExtracted: analysis.todos_extracted,
    recurringItems: analysis.recurring_items,
    inferredItems: analysis.inferred_items,
    status: analysis.status,
    reviewedBy: analysis.reviewed_by,
    reviewedAt: analysis.reviewed_at?.toISOString(),
    reviewNotes: analysis.review_notes,
    analysisError: analysis.analysis_error,
    createdAt: analysis.created_at.toISOString(),
    updatedAt: analysis.updated_at.toISOString(),
  };
}

/**
 * Generate HTML for analyses view page
 */
function generateAnalysesViewHtml(
  analyses: StoredEmailAnalysis[],
  stats: ReturnType<typeof getAnalysisStats>,
  emailMap: Map<number, StoredEmail>
): string {
  const analysesHtml = analyses.length > 0
    ? analyses.map((analysis) => {
        const email = emailMap.get(analysis.email_id);
        const emailBody = email?.body_text || '(No email body available)';
        const emailSubject = email?.subject || '(Unknown subject)';
        const emailFrom = email?.from_name || email?.from_email || '(Unknown sender)';

        return `
        <div class="analysis-card" data-analysis-id="${analysis.id}" data-email-id="${analysis.email_id}">
          <div class="analysis-header">
            <div class="analysis-summary">${escapeHtml(analysis.email_summary || '(No summary)')}</div>
            <div class="analysis-badges">
              <span class="badge badge-${analysis.status}">${analysis.status}</span>
              ${analysis.quality_score !== null ? `<span class="badge badge-quality">${(analysis.quality_score * 100).toFixed(0)}% Quality</span>` : ''}
            </div>
          </div>
          <div class="analysis-meta">
            <span>Email #${analysis.email_id}</span>
            <span>Provider: ${analysis.ai_provider}</span>
            <span>${formatDate(analysis.created_at)}</span>
          </div>
          <div class="email-info">
            <div class="detail"><strong>Subject:</strong> ${escapeHtml(emailSubject)}</div>
            <div class="detail"><strong>From:</strong> ${escapeHtml(emailFrom)}</div>
          </div>
          <div class="analysis-stats">
            <span class="stat">📅 ${analysis.events_extracted} events</span>
            <span class="stat">📝 ${analysis.todos_extracted} todos</span>
            <span class="stat">🔄 ${analysis.recurring_items} recurring</span>
            <span class="stat">💡 ${analysis.inferred_items} inferred</span>
          </div>
          <div class="analysis-details">
            <div class="detail"><strong>Tone:</strong> ${escapeHtml(analysis.email_tone || 'N/A')}</div>
            <div class="detail"><strong>Intent:</strong> ${escapeHtml(analysis.email_intent || 'N/A')}</div>
            ${analysis.implicit_context ? `<div class="detail"><strong>Context:</strong> ${escapeHtml(analysis.implicit_context)}</div>` : ''}
          </div>
          <details class="raw-email-details">
            <summary>View Raw Email</summary>
            <div class="raw-email-body">${escapeHtml(emailBody)}</div>
          </details>
          <details class="raw-ai-details">
            <summary>View AI Response</summary>
            <div class="raw-ai-body">${analysis.raw_extraction_json ? formatJsonForDisplay(analysis.raw_extraction_json) : '(No raw response available)'}</div>
          </details>
          ${analysis.analysis_error ? `<div class="analysis-error">Error: ${escapeHtml(analysis.analysis_error)}</div>` : ''}
          <div class="analysis-actions">
            <button class="btn btn-reanalyze" onclick="reanalyzeEmail(${analysis.id})">🔄 Re-analyze</button>
            ${analysis.status === 'analyzed' ? `
              <button class="btn btn-approve" onclick="approveAnalysis(${analysis.id})">✅ Approve</button>
              <button class="btn btn-reject" onclick="rejectAnalysis(${analysis.id})">❌ Reject</button>
            ` : ''}
            <button class="btn btn-delete" data-analysis-id="${analysis.id}" onclick="deleteAnalysis(this)">🗑️ Delete</button>
          </div>
          <div class="reanalyze-result" id="reanalyze-result-${analysis.id}" style="display: none;"></div>
        </div>
      `;
      }).join('')
    : '<div class="no-analyses">No analyses yet. Run analysis on emails to see results.</div>';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Analyses - Inbox Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container { max-width: 1200px; margin: 0 auto; }

    .header {
      background: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 { color: #333; margin-bottom: 10px; }

    .back-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .back-link:hover { text-decoration: underline; }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }

    .stat-card {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 1.8rem; font-weight: 700; color: #667eea; }
    .stat-label { font-size: 0.8rem; color: #666; margin-top: 5px; }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary { background: #667eea; color: white; }
    .btn-primary:hover { background: #5a6fd6; }
    .btn-approve { background: #28a745; color: white; }
    .btn-approve:hover { background: #218838; }
    .btn-reject { background: #dc3545; color: white; }
    .btn-reject:hover { background: #c82333; }
    .btn-reanalyze { background: #17a2b8; color: white; }
    .btn-reanalyze:hover { background: #138496; }
    .btn-delete { background: #6c757d; color: white; }
    .btn-delete:hover { background: #5a6268; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .content {
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .analysis-card {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      transition: all 0.2s;
    }
    .analysis-card:hover { border-color: #667eea; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

    .analysis-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 15px;
      margin-bottom: 10px;
    }
    .analysis-summary { font-weight: 600; color: #333; font-size: 1rem; flex: 1; }
    .analysis-badges { display: flex; gap: 5px; flex-wrap: wrap; }

    .badge {
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-pending { background: #fff3cd; color: #856404; }
    .badge-analyzed { background: #d1ecf1; color: #0c5460; }
    .badge-approved { background: #d4edda; color: #155724; }
    .badge-rejected { background: #f8d7da; color: #721c24; }
    .badge-reviewed { background: #e2e3e5; color: #383d41; }
    .badge-quality { background: #667eea; color: white; }

    .analysis-meta {
      display: flex;
      gap: 15px;
      font-size: 13px;
      color: #666;
      margin-bottom: 10px;
    }

    .analysis-stats {
      display: flex;
      gap: 20px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .stat { font-size: 13px; color: #555; }

    .analysis-details {
      font-size: 13px;
      color: #444;
      margin-bottom: 10px;
    }
    .detail { margin-bottom: 5px; }

    .email-info {
      font-size: 13px;
      color: #444;
      margin-bottom: 10px;
      padding: 8px;
      background: #f8f9fa;
      border-radius: 4px;
    }

    .raw-email-details, .raw-ai-details {
      margin-top: 10px;
    }
    .raw-email-details summary, .raw-ai-details summary {
      cursor: pointer;
      color: #667eea;
      font-size: 13px;
      font-weight: 500;
    }
    .raw-ai-details summary {
      color: #17a2b8;
    }
    .raw-email-body, .raw-ai-body {
      margin-top: 10px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      font-size: 12px;
      font-family: monospace;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
    }
    .raw-ai-body {
      background: #e8f4f8;
      border-color: #b8daff;
    }
    .raw-ai-body .json-key { color: #881391; }
    .raw-ai-body .json-string { color: #1a1aa6; }
    .raw-ai-body .json-number { color: #1a6; }
    .raw-ai-body .json-boolean { color: #d63384; }
    .raw-ai-body .json-null { color: #6c757d; }

    .analysis-error {
      margin-top: 10px;
      padding: 10px;
      background: #f8d7da;
      color: #721c24;
      border-radius: 4px;
      font-size: 13px;
    }

    .analysis-actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .reanalyze-result {
      margin-top: 10px;
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    .reanalyze-result.loading { background: #e3f2fd; color: #1565c0; }
    .reanalyze-result.success { background: #d4edda; color: #155724; }
    .reanalyze-result.error { background: #f8d7da; color: #721c24; }

    .no-analyses {
      text-align: center;
      padding: 40px;
      color: #666;
      font-style: italic;
    }

    #result {
      margin-top: 15px;
      padding: 15px;
      border-radius: 6px;
      display: none;
    }
    .result-success { background: #d4edda; color: #155724; }
    .result-error { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="/dashboard" class="back-link">← Back to Dashboard</a>
      <h1>🔍 Email Analyses</h1>
      <p>Two-pass AI analysis results with human review capability.</p>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.pending}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.analyzed}</div>
          <div class="stat-label">Analyzed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.approved}</div>
          <div class="stat-label">Approved</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalEvents}</div>
          <div class="stat-label">Events</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalTodos}</div>
          <div class="stat-label">Todos</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.avgQualityScore !== null ? (stats.avgQualityScore * 100).toFixed(0) + '%' : 'N/A'}</div>
          <div class="stat-label">Avg Quality</div>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="run-btn" onclick="runAnalysis()">
          🤖 Run Analysis on Unanalyzed Emails
        </button>
        <button class="btn" style="background: #6c757d; color: white;" onclick="window.location.reload()">
          🔄 Refresh
        </button>
      </div>

      <div id="result"></div>
    </div>

    <div class="content">
      <h2 style="margin-bottom: 20px;">Analyses (${analyses.length})</h2>
      ${analysesHtml}
    </div>
  </div>

  <script>
    async function runAnalysis() {
      const btn = document.getElementById('run-btn');
      const resultDiv = document.getElementById('result');

      btn.disabled = true;
      btn.textContent = '⏳ Running...';
      resultDiv.style.display = 'none';

      try {
        const response = await fetch('/api/analyses/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          resultDiv.className = 'result-success';
          resultDiv.innerHTML = \`
            <strong>✅ Analysis complete!</strong><br>
            Processed: \${data.processed} | Successful: \${data.successful} | Failed: \${data.failed}<br>
            Events created: \${data.eventsCreated} | Todos created: \${data.todosCreated}
          \`;
          setTimeout(() => window.location.reload(), 2000);
        } else {
          throw new Error(data.message || data.error || 'Analysis failed');
        }
      } catch (error) {
        resultDiv.className = 'result-error';
        resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
      } finally {
        resultDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🤖 Run Analysis on Unanalyzed Emails';
      }
    }

    async function approveAnalysis(id) {
      try {
        const response = await fetch('/api/analyses/' + id + '/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          window.location.reload();
        } else {
          alert('Failed to approve analysis');
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function rejectAnalysis(id) {
      const notes = prompt('Rejection reason (optional):');
      try {
        const response = await fetch('/api/analyses/' + id + '/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        });

        if (response.ok) {
          window.location.reload();
        } else {
          alert('Failed to reject analysis');
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function deleteAnalysis(btn) {
      const analysisId = btn.dataset.analysisId;
      const card = btn.closest('.analysis-card');
      const summary = card.querySelector('.analysis-summary')?.textContent || 'this analysis';

      if (!confirm('Delete analysis?\\n\\n"' + summary.substring(0, 100) + '..."')) {
        return;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Deleting...';

      try {
        const response = await fetch('/api/analyses/' + analysisId, {
          method: 'DELETE'
        });

        if (response.ok) {
          card.style.transition = 'opacity 0.3s, transform 0.3s';
          card.style.opacity = '0';
          card.style.transform = 'translateX(-20px)';
          setTimeout(() => card.remove(), 300);
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Delete failed');
        }
      } catch (error) {
        alert('Error deleting analysis: ' + error.message);
        btn.disabled = false;
        btn.textContent = '🗑️ Delete';
      }
    }

    async function reanalyzeEmail(analysisId) {
      const resultDiv = document.getElementById('reanalyze-result-' + analysisId);
      const card = document.querySelector('[data-analysis-id="' + analysisId + '"]');
      const btn = card.querySelector('.btn-reanalyze');

      btn.disabled = true;
      btn.textContent = '⏳ Analyzing...';
      resultDiv.style.display = 'block';
      resultDiv.className = 'reanalyze-result loading';
      resultDiv.innerHTML = 'Running AI analysis... This may take a moment.';

      try {
        const response = await fetch('/api/analyses/' + analysisId + '/reanalyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok && data.success) {
          resultDiv.className = 'reanalyze-result success';
          resultDiv.innerHTML = \`
            <strong>✅ Re-analysis complete!</strong><br>
            <strong>New Summary:</strong> \${data.analysis?.emailSummary || 'N/A'}<br>
            <strong>Tone:</strong> \${data.analysis?.emailTone || 'N/A'} | <strong>Intent:</strong> \${data.analysis?.emailIntent || 'N/A'}<br>
            <strong>Quality:</strong> \${data.qualityScore ? (data.qualityScore * 100).toFixed(0) + '%' : 'N/A'}<br>
            <strong>Events:</strong> \${data.eventsCreated} | <strong>Todos:</strong> \${data.todosCreated}<br>
            <em>Refreshing page in 3 seconds...</em>
          \`;
          setTimeout(() => window.location.reload(), 3000);
        } else {
          throw new Error(data.message || data.error || 'Re-analysis failed');
        }
      } catch (error) {
        resultDiv.className = 'reanalyze-result error';
        resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
        btn.disabled = false;
        btn.textContent = '🔄 Re-analyze';
      }
    }
  </script>
</body>
</html>
  `;
}

/**
 * Format email for API response
 */
function formatEmailForApi(email: StoredEmail) {
  return {
    id: email.id,
    gmailMessageId: email.gmail_message_id,
    gmailThreadId: email.gmail_thread_id,
    from: email.from_email,
    fromName: email.from_name,
    subject: email.subject,
    date: email.date.toISOString(),
    snippet: email.snippet,
    bodyText: email.body_text,
    labels: email.labels,
    hasAttachments: email.has_attachments,
    attachmentContent: email.attachment_content,
    processed: email.processed,
    analyzed: email.analyzed,
    gmailLabeled: email.gmail_labeled,
    fetchError: email.fetch_error,
    createdAt: email.created_at.toISOString(),
    updatedAt: email.updated_at.toISOString(),
  };
}

/**
 * Generate HTML for emails view page
 */
function generateEmailsViewHtml(
  emails: StoredEmail[],
  stats: { total: number; processed: number; analyzed: number }
): string {
  const emailsHtml = emails.length > 0
    ? emails.map((email, index) => `
        <div class="email-card" data-email-id="${email.id}">
          <div class="email-header">
            <div class="email-subject">${escapeHtml(email.subject)}</div>
            <div class="email-badges">
              ${email.processed ? '<span class="badge badge-success">Processed</span>' : '<span class="badge badge-warning">Pending</span>'}
              ${email.analyzed ? '<span class="badge badge-info">Analyzed</span>' : ''}
              ${email.gmail_labeled ? '<span class="badge badge-secondary">Gmail Labeled</span>' : ''}
              ${email.has_attachments ? '<span class="badge badge-attachment">📎 Attachment</span>' : ''}
            </div>
          </div>
          <div class="email-meta">
            <span class="email-from">From: ${escapeHtml(email.from_name || email.from_email)}</span>
            <span class="email-date">${formatDate(email.date)}</span>
          </div>
          ${email.labels && email.labels.length > 0 ? `
            <div class="email-labels">
              ${email.labels.map(label => `<span class="label-tag">${escapeHtml(label)}</span>`).join('')}
            </div>
          ` : ''}
          <div class="email-snippet">${escapeHtml(email.snippet || '')}</div>
          <details class="email-body-details">
            <summary>View Full Body</summary>
            <div class="email-body">${escapeHtml(email.body_text || '(No body content)')}</div>
          </details>
          ${email.fetch_error ? `<div class="email-error">Error: ${escapeHtml(email.fetch_error)}</div>` : ''}
          <div class="email-actions">
            <button class="btn btn-delete btn-sm" data-email-id="${email.id}" onclick="deleteEmail(this)">🗑️ Delete</button>
          </div>
        </div>
      `).join('')
    : '<div class="no-emails">No emails stored yet. Click "Fetch Emails from Gmail" to import emails.</div>';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stored Emails - Inbox Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container { max-width: 1200px; margin: 0 auto; }

    .header {
      background: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 { color: #333; margin-bottom: 10px; }

    .back-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .back-link:hover { text-decoration: underline; }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }

    .stat-card {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 2rem; font-weight: 700; color: #667eea; }
    .stat-label { font-size: 0.85rem; color: #666; margin-top: 5px; }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary { background: #667eea; color: white; }
    .btn-primary:hover { background: #5a6fd6; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-secondary:hover { background: #5a6268; }
    .btn-delete { background: #dc3545; color: white; }
    .btn-delete:hover { background: #c82333; }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .fetch-options {
      display: flex;
      gap: 15px;
      align-items: center;
      margin-top: 15px;
      flex-wrap: wrap;
    }
    .fetch-options label { font-size: 14px; color: #666; }
    .fetch-options select, .fetch-options input {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .content {
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .email-card {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      transition: all 0.2s;
    }
    .email-card:hover { border-color: #667eea; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

    .email-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 15px;
      margin-bottom: 10px;
    }
    .email-subject { font-weight: 600; color: #333; font-size: 1.1rem; flex: 1; }
    .email-badges { display: flex; gap: 5px; flex-wrap: wrap; }

    .badge {
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-info { background: #d1ecf1; color: #0c5460; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    .badge-attachment { background: #f8d7da; color: #721c24; }

    .email-meta {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #666;
      margin-bottom: 10px;
    }

    .email-labels {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .label-tag {
      background: #e3f2fd;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      color: #1565c0;
    }

    .email-snippet {
      font-size: 14px;
      color: #555;
      line-height: 1.5;
      margin-bottom: 10px;
    }

    .email-body-details {
      margin-top: 10px;
    }
    .email-body-details summary {
      cursor: pointer;
      color: #667eea;
      font-size: 13px;
      font-weight: 500;
    }
    .email-body {
      margin-top: 10px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
    }

    .email-error {
      margin-top: 10px;
      padding: 10px;
      background: #f8d7da;
      color: #721c24;
      border-radius: 4px;
      font-size: 13px;
    }

    .email-actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
    }

    .no-emails {
      text-align: center;
      padding: 40px;
      color: #666;
      font-style: italic;
    }

    #fetch-result {
      margin-top: 15px;
      padding: 15px;
      border-radius: 6px;
      display: none;
    }
    .result-success { background: #d4edda; color: #155724; }
    .result-error { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="/dashboard" class="back-link">← Back to Dashboard</a>
      <h1>📧 Stored Emails</h1>
      <p>Emails fetched from Gmail and stored in the database for processing.</p>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">Total Emails</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.processed}</div>
          <div class="stat-label">Processed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.analyzed}</div>
          <div class="stat-label">Analyzed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.total - stats.analyzed}</div>
          <div class="stat-label">Pending Analysis</div>
        </div>
      </div>

      <div class="fetch-options">
        <label>
          Date Range:
          <select id="date-range">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last3days" selected>Last 3 Days</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
          </select>
        </label>
        <label>
          Max Emails:
          <input type="number" id="max-results" value="100" min="1" max="500" style="width: 80px;">
        </label>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="fetch-btn" onclick="fetchEmails()">
          📥 Fetch Emails from Gmail
        </button>
        <button class="btn btn-secondary" onclick="window.location.reload()">
          🔄 Refresh Page
        </button>
      </div>

      <div id="fetch-result"></div>
    </div>

    <div class="content">
      <h2 style="margin-bottom: 20px;">Emails (${emails.length})</h2>
      ${emailsHtml}
    </div>
  </div>

  <script>
    async function fetchEmails() {
      const btn = document.getElementById('fetch-btn');
      const resultDiv = document.getElementById('fetch-result');
      const dateRange = document.getElementById('date-range').value;
      const maxResults = parseInt(document.getElementById('max-results').value);

      btn.disabled = true;
      btn.textContent = '⏳ Fetching...';
      resultDiv.style.display = 'none';

      try {
        const response = await fetch('/api/emails/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateRange, maxResults })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          resultDiv.className = 'result-success';
          resultDiv.innerHTML = \`
            <strong>✅ Email fetch complete!</strong><br>
            Fetched: \${data.fetched} | Stored: \${data.stored} | Skipped: \${data.skipped} | Errors: \${data.errors}<br>
            Gmail labels synced: \${data.labelSync?.labeled || 0}
            \${data.errorMessages && data.errorMessages.length > 0 ? '<br><small>Errors: ' + data.errorMessages.join(', ') + '</small>' : ''}
          \`;

          // Reload page after 2 seconds to show new emails
          setTimeout(() => window.location.reload(), 2000);
        } else {
          throw new Error(data.message || data.error || 'Fetch failed');
        }
      } catch (error) {
        resultDiv.className = 'result-error';
        resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
      } finally {
        resultDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '📥 Fetch Emails from Gmail';
      }
    }

    async function deleteEmail(btn) {
      const emailId = btn.dataset.emailId;
      const card = btn.closest('.email-card');
      const subject = card.querySelector('.email-subject')?.textContent || 'this email';

      if (!confirm('Delete "' + subject + '"?\\n\\nThis will also delete any associated analysis.')) {
        return;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Deleting...';

      try {
        const response = await fetch('/api/emails/' + emailId, {
          method: 'DELETE'
        });

        if (response.ok) {
          card.style.transition = 'opacity 0.3s, transform 0.3s';
          card.style.opacity = '0';
          card.style.transform = 'translateX(-20px)';
          setTimeout(() => card.remove(), 300);
        } else {
          const data = await response.json();
          throw new Error(data.error || 'Delete failed');
        }
      } catch (error) {
        alert('Error deleting email: ' + error.message);
        btn.disabled = false;
        btn.textContent = '🗑️ Delete';
      }
    }
  </script>
</body>
</html>
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

/**
 * Format JSON string for display with syntax highlighting
 */
function formatJsonForDisplay(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    const formatted = JSON.stringify(parsed, null, 2);

    // Apply syntax highlighting
    return escapeHtml(formatted)
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  } catch {
    // If JSON parsing fails, just escape and return as-is
    return escapeHtml(jsonString);
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
