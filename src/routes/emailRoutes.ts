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
import { getUser } from '../db/userDb.js';
import { analyzeEmail, analyzeUnanalyzedEmails, reanalyzeEmail } from '../parsers/twoPassAnalyzer.js';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { requireAdmin } from '../middleware/authorization.js';
import { fetchAndStoreEmails, syncProcessedLabels } from '../utils/emailStorageService.js';
import type { DateRange } from '../utils/inboxFetcher.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderEmailsViewContent, renderEmailsViewScripts } from '../templates/emailsViewContent.js';
import { renderAnalysesViewContent, renderAnalysesViewScripts } from '../templates/analysesViewContent.js';

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
   * HTML view for viewing stored emails (ADMIN only)
   */
  fastify.get('/emails-view', { preHandler: requireAdmin }, async (request, reply) => {
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

    // Check for impersonation (already parsed by session middleware)
    const impersonatingUserId = (request as any).impersonatingUserId;

    const effectiveUserId = impersonatingUserId || realUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;
    const realUser = getUser(realUserId);

    try {
      const emails = listEmails(effectiveUserId, 100, 0);
      const stats = getEmailStats(effectiveUserId);

      const content = renderEmailsViewContent({ emails, stats });
      const scripts = renderEmailsViewScripts();

      const html = renderLayout({
        title: 'Stored Emails',
        currentPath: '/emails-view',
        user: { email: realUser?.email || '', name: realUser?.name },
        userRoles,
        impersonating: effectiveUser ? { email: effectiveUser.email } : null,
        content,
        scripts,
      });

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
   * HTML view for viewing email analyses (ADMIN only)
   */
  fastify.get('/analyses-view', { preHandler: requireAdmin }, async (request, reply) => {
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

    // Check for impersonation (already parsed by session middleware)
    const impersonatingUserId = (request as any).impersonatingUserId;

    const effectiveUserId = impersonatingUserId || realUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;
    const realUser = getUser(realUserId);

    try {
      const analyses = listEmailAnalyses(effectiveUserId, 100, 0);
      const stats = getAnalysisStats(effectiveUserId);

      // Fetch emails to get body text for raw email display
      const emailIds = [...new Set(analyses.map((a) => a.email_id))];
      const emailMap = new Map<number, StoredEmail>();
      for (const emailId of emailIds) {
        const email = getEmailById(effectiveUserId, emailId);
        if (email) {
          emailMap.set(emailId, email);
        }
      }

      const content = renderAnalysesViewContent({ analyses, stats, emailMap });
      const scripts = renderAnalysesViewScripts();

      const html = renderLayout({
        title: 'Email Analyses',
        currentPath: '/analyses-view',
        user: { email: realUser?.email || '', name: realUser?.name },
        userRoles,
        impersonating: effectiveUser ? { email: effectiveUser.email } : null,
        content,
        scripts,
      });

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
