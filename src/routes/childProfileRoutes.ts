// src/routes/childProfileRoutes.ts

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { fetchRecentEmails, fetchRecentEmailsWithBody, fetchAllSenders } from '../utils/inboxFetcher.js';
import { extractChildProfiles } from '../parsers/childProfileExtractor.js';
import {
  createChildProfile,
  getChildProfiles,
  getChildProfile,
  updateChildProfile,
  deleteChildProfile,
  completeOnboarding,
  hasCompletedOnboarding,
  createChildProfilesBatch,
} from '../db/childProfilesDb.js';
import type { ChildProfile } from '../types/childProfile.js';
import { upsertSenderFiltersBatch, upsertSenderFilter, getSenderFilters, getIncludedSenders, hasSenderFilters, deleteSenderFilter } from '../db/senderFilterDb.js';
import { updateOnboardingStep, getUser } from '../db/userDb.js';
import { rankSenderRelevance, rerankSendersWithContext } from '../utils/senderRelevanceRanker.js';
import type { RankedSender } from '../utils/senderRelevanceRanker.js';
import {
  insertFeedbackItemsBatch,
  getFeedbackItems,
  getUngradedFeedbackItems,
  updateFeedbackGradesBatch,
  getFeedbackStats,
  clearFeedbackItems,
  deleteFeedbackItem,
} from '../db/relevanceFeedbackDb.js';
import { updateSenderFilterScores, getLowRelevanceSenders } from '../utils/senderScoreCalculator.js';
import {
  createScan,
  createJob,
  updateScanStatus,
  updateJobStatus,
  completeScan,
  completeJob,
  failScan,
  failJob,
  getLatestScan,
  getLatestJob,
  isScanInProgress,
  isJobInProgress,
  type JobStatus,
} from '../db/onboardingScanDb.js';

/**
 * Zod schema for running onboarding analysis
 */
const OnboardingAnalysisSchema = z.object({
  aiProvider: z.enum(['openai', 'anthropic']).optional(),
  schoolContext: z.array(z.object({
    name: z.string(),
    year_groups: z.array(z.string()),
  })).optional(),
});

/**
 * Zod schema for confirming onboarding results
 */
const ConfirmOnboardingSchema = z.object({
  profiles: z.array(
    z.object({
      real_name: z.string().min(1),
      display_name: z.string().optional(),
      year_group: z.string().optional(),
      school_name: z.string().optional(),
      notes: z.string().optional(),
    })
  ),
});

/**
 * Zod schema for updating child profile
 */
const UpdateProfileSchema = z.object({
  real_name: z.string().min(1).optional(),
  display_name: z.string().optional(),
  year_group: z.string().optional(),
  school_name: z.string().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional(),
});

/**
 * Register child profile routes
 */
export async function childProfileRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /onboarding/analyze
   * Start background analysis to extract child profile information.
   * Returns immediately - poll GET /onboarding/analyze/status for results.
   */
  fastify.post<{
    Body: z.infer<typeof OnboardingAnalysisSchema>;
  }>('/onboarding/analyze', { preHandler: requireAuth }, async (request, reply) => {
    const bodyResult = OnboardingAnalysisSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);

      // Check if analysis already in progress
      if (isJobInProgress(userId, 'analyze_children')) {
        return reply.code(200).send({
          success: true,
          status: 'scanning',
          message: 'Analysis already in progress',
        });
      }

      // Get auth before starting background job
      let auth;
      try {
        auth = await getUserAuth(request);
      } catch (authError: any) {
        return reply.code(401).send({
          error: 'Gmail not connected',
          message: authError.message,
        });
      }

      const provider = bodyResult.data.aiProvider || 'openai';
      const schoolContext = bodyResult.data.schoolContext;

      // Create job record
      const jobId = createJob(userId, 'analyze_children');
      console.log(`[POST /analyze] Created job ${jobId} for user ${userId}`);
      fastify.log.info({ userId, jobId }, 'Starting background child analysis');

      // Start background analysis (don't await!)
      runBackgroundAnalysis(jobId, userId, auth, provider, schoolContext, fastify.log).catch(err => {
        console.error(`[POST /analyze] Background analysis error:`, err);
        fastify.log.error({ err, jobId, userId }, 'Background analysis failed');
      });

      // Return immediately
      return reply.code(202).send({
        success: true,
        status: 'scanning',
        message: 'Analysis started. Poll /onboarding/analyze/status for results.',
        jobId,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error starting analysis');
      return reply.code(500).send({
        error: 'Failed to start analysis',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/analyze/status
   * Check the status of background child analysis.
   */
  fastify.get('/onboarding/analyze/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const job = getLatestJob(userId, 'analyze_children');

      if (!job) {
        return reply.code(404).send({
          error: 'No analysis found',
          message: 'No analysis has been started.',
        });
      }

      const response: any = {
        status: job.status,
        started_at: job.started_at.toISOString(),
      };

      if (job.status === 'complete' && job.result_json) {
        const result = JSON.parse(job.result_json);
        response.result = result;
        response.completed_at = job.completed_at?.toISOString();
        response.success = true;
      } else if (job.status === 'failed') {
        response.error = job.error_message || 'Analysis failed';
        response.completed_at = job.completed_at?.toISOString();
        response.success = false;
      }

      return reply.code(200).send(response);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting analysis status');
      return reply.code(500).send({
        error: 'Failed to get status',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/confirm
   * Confirm and save child profiles from onboarding
   */
  fastify.post<{
    Body: z.infer<typeof ConfirmOnboardingSchema>;
  }>('/onboarding/confirm', { preHandler: requireAuth }, async (request, reply) => {
    const bodyResult = ConfirmOnboardingSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);

      const profiles: ChildProfile[] = bodyResult.data.profiles.map((p) => ({
        user_id: userId,
        real_name: p.real_name,
        display_name: p.display_name,
        year_group: p.year_group,
        school_name: p.school_name,
        notes: p.notes,
        is_active: true,
        onboarding_completed: true,
      }));

      // Batch create profiles
      const ids = createChildProfilesBatch(profiles);

      // Mark onboarding as complete
      updateOnboardingStep(userId, 5);

      fastify.log.info(
        { userId, profileCount: ids.length },
        'Onboarding confirmed, profiles created'
      );

      return reply.code(200).send({
        success: true,
        message: `${ids.length} child profile(s) created successfully`,
        profile_ids: ids,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error confirming onboarding');
      return reply.code(500).send({
        error: 'Failed to create profiles',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/scan-inbox
   * Start background inbox scan for unique senders.
   * Returns immediately with scan status - poll GET /onboarding/scan-inbox/status for results.
   */
  fastify.post<{
    Body: { broadSearch?: boolean };
  }>('/onboarding/scan-inbox', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      // Check if scan already in progress
      if (isScanInProgress(userId)) {
        return reply.code(200).send({
          success: true,
          status: 'scanning',
          message: 'Scan already in progress',
        });
      }

      // Get auth before starting background job (to fail fast if not connected)
      let auth;
      try {
        auth = await getUserAuth(request);
      } catch (authError: any) {
        fastify.log.error({ userId, err: authError }, 'Failed to get user auth for inbox scan');
        return reply.code(401).send({
          error: 'Gmail not connected',
          message: authError.message?.includes('No auth found')
            ? 'Please reconnect your Gmail account. Go back to step 1 and click "Connect your Gmail inbox".'
            : authError.message,
        });
      }

      // Create scan record
      const scanId = createScan(userId);
      console.log(`[POST /scan-inbox] Created scan ${scanId} for user ${userId}`);
      fastify.log.info({ userId, scanId }, 'Starting background inbox scan');

      // Start background scan (don't await!)
      console.log(`[POST /scan-inbox] Starting background scan...`);
      runBackgroundScan(scanId, userId, auth, fastify.log).catch(err => {
        console.error(`[POST /scan-inbox] Background scan error:`, err);
        fastify.log.error({ err, scanId, userId }, 'Background scan failed');
      });
      console.log(`[POST /scan-inbox] Background scan started (not awaiting)`);

      // Return immediately
      return reply.code(202).send({
        success: true,
        status: 'scanning',
        message: 'Scan started. Poll /onboarding/scan-inbox/status for results.',
        scanId,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error starting inbox scan');
      return reply.code(500).send({
        error: 'Failed to start inbox scan',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/scan-inbox/status
   * Check the status of the background inbox scan.
   */
  fastify.get('/onboarding/scan-inbox/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const scan = getLatestScan(userId);

      if (!scan) {
        return reply.code(404).send({
          error: 'No scan found',
          message: 'No inbox scan has been started. Call POST /onboarding/scan-inbox first.',
        });
      }

      // Base response
      const response: any = {
        status: scan.status,
        started_at: scan.started_at.toISOString(),
      };

      if (scan.status === 'complete' && scan.result_json) {
        // Include results when complete
        const result = JSON.parse(scan.result_json);
        response.senders = result.senders;
        response.total_emails = result.total_emails;
        response.completed_at = scan.completed_at?.toISOString();
        response.success = true;
      } else if (scan.status === 'failed') {
        response.error = scan.error_message || 'Scan failed';
        response.completed_at = scan.completed_at?.toISOString();
        response.success = false;
      }

      return reply.code(200).send(response);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting scan status');
      return reply.code(500).send({
        error: 'Failed to get scan status',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/rerank-senders
   * Re-rank candidate senders using approved senders as context.
   * Called between sub-step A (high relevance) and sub-step B (mid-tier review).
   */
  fastify.post<{
    Body: { approvedSenders: RankedSender[]; candidateSenders: RankedSender[] };
  }>('/onboarding/rerank-senders', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { approvedSenders, candidateSenders } = request.body;

      if (!Array.isArray(approvedSenders) || !Array.isArray(candidateSenders)) {
        return reply.code(400).send({ error: 'approvedSenders and candidateSenders arrays are required' });
      }

      const reranked = await rerankSendersWithContext(approvedSenders, candidateSenders);

      fastify.log.info(
        { approvedCount: approvedSenders.length, candidateCount: candidateSenders.length, rerankedCount: reranked.length },
        'Senders re-ranked with context'
      );

      return reply.code(200).send({
        success: true,
        senders: reranked,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error re-ranking senders');
      return reply.code(500).send({
        error: 'Failed to re-rank senders',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/save-senders
   * Save sender include/exclude selections
   */
  fastify.post<{
    Body: {
      senders: Array<{ email: string; name?: string; status: 'include' | 'exclude' }>;
    };
  }>('/onboarding/save-senders', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { senders } = request.body;

      if (!senders || !Array.isArray(senders)) {
        return reply.code(400).send({ error: 'senders array is required' });
      }

      const filters = senders.map((s) => ({
        user_id: userId,
        sender_email: s.email,
        sender_name: s.name,
        status: s.status,
      }));

      upsertSenderFiltersBatch(filters);
      updateOnboardingStep(userId, 3); // Step 3: Senders selected

      const included = filters.filter((f) => f.status === 'include').length;
      const excluded = filters.filter((f) => f.status === 'exclude').length;

      fastify.log.info(
        { userId, included, excluded },
        'Sender filters saved during onboarding'
      );

      return reply.code(200).send({
        success: true,
        included,
        excluded,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error saving sender filters');
      return reply.code(500).send({
        error: 'Failed to save sender filters',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/extract-for-training
   * Start background extraction of todos/events from approved senders for user to grade.
   * Returns immediately - poll GET /onboarding/extract-for-training/status for results.
   */
  fastify.post('/onboarding/extract-for-training', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      // Check if extraction already in progress
      if (isJobInProgress(userId, 'extract_training')) {
        return reply.code(200).send({
          success: true,
          status: 'scanning',
          message: 'Extraction already in progress',
        });
      }

      // Get auth before starting background job
      let auth;
      try {
        auth = await getUserAuth(request);
      } catch (authError: any) {
        return reply.code(401).send({
          error: 'Gmail not connected',
          message: authError.message,
        });
      }

      // Get included senders
      const includedSenders = getIncludedSenders(userId);
      if (includedSenders.length === 0) {
        return reply.code(400).send({
          error: 'No senders selected',
          message: 'Please select senders first',
        });
      }

      // Create job record
      const jobId = createJob(userId, 'extract_training');
      fastify.log.info({ userId, jobId }, 'Starting background extraction for training');

      // Start background extraction (don't await!)
      runBackgroundExtraction(jobId, userId, auth, includedSenders, fastify.log).catch(err => {
        fastify.log.error({ err, jobId, userId }, 'Background extraction failed');
      });

      // Return immediately
      return reply.code(202).send({
        success: true,
        status: 'scanning',
        message: 'Extraction started. Poll /onboarding/extract-for-training/status for results.',
        jobId,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error starting extraction for training');
      return reply.code(500).send({
        error: 'Failed to start extraction',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/extract-for-training/status
   * Check the status of background extraction job.
   */
  fastify.get('/onboarding/extract-for-training/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const job = getLatestJob(userId, 'extract_training');

      if (!job) {
        return reply.code(404).send({
          error: 'No extraction found',
          message: 'No extraction has been started.',
        });
      }

      const response: any = {
        status: job.status,
        started_at: job.started_at.toISOString(),
      };

      if (job.status === 'complete' && job.result_json) {
        const result = JSON.parse(job.result_json);
        // Fetch items from database (they have IDs needed for grading)
        const dbItems = getFeedbackItems(userId);
        response.items = dbItems;
        response.emailsProcessed = result.emailsProcessed;
        response.completed_at = job.completed_at?.toISOString();
        response.success = true;
      } else if (job.status === 'failed') {
        response.error = job.error_message || 'Extraction failed';
        response.completed_at = job.completed_at?.toISOString();
        response.success = false;
      }

      return reply.code(200).send(response);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting extraction status');
      return reply.code(500).send({
        error: 'Failed to get extraction status',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/save-feedback
   * Save user's relevance grades for extracted items
   */
  fastify.post<{
    Body: { grades: Array<{ id: number; isRelevant: boolean }> };
  }>('/onboarding/save-feedback', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { grades } = request.body;

      if (!grades || !Array.isArray(grades)) {
        return reply.code(400).send({ error: 'grades array is required' });
      }

      const updated = updateFeedbackGradesBatch(userId, grades);

      // Update sender filter scores based on new feedback
      const scoresUpdated = updateSenderFilterScores(userId);

      fastify.log.info({ userId, updated, scoresUpdated }, 'Saved relevance feedback and updated sender scores');

      return reply.code(200).send({
        success: true,
        updated,
        scoresUpdated,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error saving feedback');
      return reply.code(500).send({
        error: 'Failed to save feedback',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/relevance-feedback
   * Get all feedback items for settings page
   */
  fastify.get('/api/relevance-feedback', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const items = getFeedbackItems(userId);
      const stats = getFeedbackStats(userId);

      return reply.code(200).send({
        success: true,
        items,
        stats,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to fetch feedback',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/relevance-feedback/:id
   * Update a single feedback item's grade (for settings page)
   */
  fastify.put<{
    Params: { id: string };
    Body: { isRelevant: boolean };
  }>('/api/relevance-feedback/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const itemId = parseInt(request.params.id, 10);
      const { isRelevant } = request.body;

      if (isNaN(itemId)) {
        return reply.code(400).send({ error: 'Invalid item ID' });
      }

      if (typeof isRelevant !== 'boolean') {
        return reply.code(400).send({ error: 'isRelevant boolean is required' });
      }

      const updated = updateFeedbackGradesBatch(userId, [{ id: itemId, isRelevant }]);

      // Update sender filter scores based on new feedback
      updateSenderFilterScores(userId);

      return reply.code(200).send({
        success: updated > 0,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to update feedback',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /api/relevance-feedback/:id
   * Delete a feedback item
   */
  fastify.delete<{
    Params: { id: string };
  }>('/api/relevance-feedback/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const itemId = parseInt(request.params.id, 10);

      if (isNaN(itemId)) {
        return reply.code(400).send({ error: 'Invalid item ID' });
      }

      const deleted = deleteFeedbackItem(userId, itemId);

      return reply.code(200).send({
        success: deleted,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to delete feedback item',
        message: error.message,
      });
    }
  });

  // ============================================
  // SENDER FILTER MANAGEMENT API
  // ============================================

  /**
   * GET /api/sender-filters
   * Get all sender filters for the user
   */
  fastify.get('/api/sender-filters', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const filters = getSenderFilters(userId);

      return reply.code(200).send({
        success: true,
        filters,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to fetch sender filters',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/sender-filters
   * Add a new sender filter
   */
  fastify.post<{
    Body: { email: string; name?: string; status: 'include' | 'exclude' };
  }>('/api/sender-filters', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { email, name, status } = request.body;

      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'Valid email address is required' });
      }

      if (!['include', 'exclude'].includes(status)) {
        return reply.code(400).send({ error: 'Status must be "include" or "exclude"' });
      }

      upsertSenderFilter({
        user_id: userId,
        sender_email: email.toLowerCase().trim(),
        sender_name: name?.trim(),
        status,
      });

      fastify.log.info({ userId, email, status }, 'Sender filter added/updated');

      return reply.code(200).send({
        success: true,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to add sender filter',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/sender-filters/:email
   * Update a sender filter's status
   */
  fastify.put<{
    Params: { email: string };
    Body: { status: 'include' | 'exclude'; name?: string };
  }>('/api/sender-filters/:email', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const email = decodeURIComponent(request.params.email).toLowerCase().trim();
      const { status, name } = request.body;

      if (!['include', 'exclude'].includes(status)) {
        return reply.code(400).send({ error: 'Status must be "include" or "exclude"' });
      }

      upsertSenderFilter({
        user_id: userId,
        sender_email: email,
        sender_name: name,
        status,
      });

      fastify.log.info({ userId, email, status }, 'Sender filter updated');

      return reply.code(200).send({
        success: true,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to update sender filter',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /api/sender-filters/:email
   * Delete a sender filter
   */
  fastify.delete<{
    Params: { email: string };
  }>('/api/sender-filters/:email', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const email = decodeURIComponent(request.params.email).toLowerCase().trim();

      const deleted = deleteSenderFilter(userId, email);

      fastify.log.info({ userId, email, deleted }, 'Sender filter deleted');

      return reply.code(200).send({
        success: deleted,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to delete sender filter',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/sender-warnings
   * Get warnings for included senders with low relevance scores.
   * Returns senders that might warrant exclusion based on user feedback.
   */
  fastify.get<{
    Querystring: { threshold?: string };
  }>('/api/sender-warnings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const threshold = request.query.threshold ? parseFloat(request.query.threshold) : 0.3;

      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        return reply.code(400).send({ error: 'Threshold must be between 0 and 1' });
      }

      const warnings = getLowRelevanceSenders(userId, threshold);

      return reply.code(200).send({
        success: true,
        warnings,
        count: warnings.length,
        threshold,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching sender warnings');
      return reply.code(500).send({
        error: 'Failed to fetch sender warnings',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/senders
   * Get current sender filter list (for review step)
   */
  fastify.get('/onboarding/senders', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const filters = getSenderFilters(userId);

      return reply.code(200).send({
        success: true,
        filters,
      });
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Failed to fetch sender filters',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/status
   * Check if user has completed onboarding
   */
  fastify.get('/onboarding/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const completed = hasCompletedOnboarding(userId);

      return reply.code(200).send({
        onboarding_completed: completed,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error checking onboarding status');
      return reply.code(500).send({
        error: 'Failed to check onboarding status',
        message: error.message,
      });
    }
  });

  /**
   * GET /child-profiles
   * Get all child profiles for the user
   */
  fastify.get('/child-profiles', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const profiles = getChildProfiles(userId);

      return reply.code(200).send({
        profiles,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching child profiles');
      return reply.code(500).send({
        error: 'Failed to fetch profiles',
        message: error.message,
      });
    }
  });

  /**
   * GET /child-profiles/:id
   * Get a single child profile
   */
  fastify.get<{
    Params: { id: string };
  }>('/child-profiles/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const profileId = parseInt(request.params.id, 10);

      if (isNaN(profileId)) {
        return reply.code(400).send({
          error: 'Invalid profile ID',
        });
      }

      const profile = getChildProfile(userId, profileId);

      if (!profile) {
        return reply.code(404).send({
          error: 'Profile not found',
        });
      }

      return reply.code(200).send({
        profile,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching child profile');
      return reply.code(500).send({
        error: 'Failed to fetch profile',
        message: error.message,
      });
    }
  });

  /**
   * PUT /child-profiles/:id
   * Update a child profile
   */
  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof UpdateProfileSchema>;
  }>('/child-profiles/:id', { preHandler: requireAuth }, async (request, reply) => {
    const bodyResult = UpdateProfileSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const profileId = parseInt(request.params.id, 10);

      if (isNaN(profileId)) {
        return reply.code(400).send({
          error: 'Invalid profile ID',
        });
      }

      const success = updateChildProfile(userId, profileId, bodyResult.data);

      if (!success) {
        return reply.code(404).send({
          error: 'Profile not found',
        });
      }

      fastify.log.info({ userId, profileId }, 'Child profile updated');

      return reply.code(200).send({
        success: true,
        message: 'Profile updated successfully',
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error updating child profile');
      return reply.code(500).send({
        error: 'Failed to update profile',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /child-profiles/:id
   * Delete a child profile
   */
  fastify.delete<{
    Params: { id: string };
  }>('/child-profiles/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const profileId = parseInt(request.params.id, 10);

      if (isNaN(profileId)) {
        return reply.code(400).send({
          error: 'Invalid profile ID',
        });
      }

      const success = deleteChildProfile(userId, profileId);

      if (!success) {
        return reply.code(404).send({
          error: 'Profile not found',
        });
      }

      fastify.log.info({ userId, profileId }, 'Child profile deleted');

      return reply.code(200).send({
        success: true,
        message: 'Profile deleted successfully',
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error deleting child profile');
      return reply.code(500).send({
        error: 'Failed to delete profile',
        message: error.message,
      });
    }
  });

  /**
   * POST /onboarding/generate-first-email
   * Start background job to generate and send the user's first daily briefing email.
   * Returns immediately - poll GET /onboarding/generate-first-email/status for results.
   */
  fastify.post('/onboarding/generate-first-email', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      // Check if generation already in progress
      if (isJobInProgress(userId, 'generate_email')) {
        return reply.code(200).send({
          success: true,
          status: 'scanning',
          message: 'Email generation already in progress',
        });
      }

      // Get auth before starting background job
      let auth;
      try {
        auth = await getUserAuth(request);
      } catch (authError: any) {
        return reply.code(401).send({
          error: 'Gmail not connected',
          message: authError.message,
        });
      }

      // Create job record
      const jobId = createJob(userId, 'generate_email');
      fastify.log.info({ userId, jobId }, 'Starting background email generation');

      // Start background job (don't await!)
      runBackgroundGenerateEmail(jobId, userId, auth, fastify.log).catch(err => {
        fastify.log.error({ err, jobId, userId }, 'Background email generation failed');
      });

      // Return immediately
      return reply.code(202).send({
        success: true,
        status: 'scanning',
        message: 'Email generation started. Poll /onboarding/generate-first-email/status for results.',
        jobId,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error starting email generation');
      return reply.code(500).send({
        error: 'Failed to start email generation',
        message: error.message,
      });
    }
  });

  /**
   * GET /onboarding/generate-first-email/status
   * Check the status of background email generation job.
   */
  fastify.get('/onboarding/generate-first-email/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const job = getLatestJob(userId, 'generate_email');

      if (!job) {
        return reply.code(404).send({
          error: 'No email generation found',
          message: 'No email generation has been started.',
        });
      }

      const response: any = {
        status: job.status,
        started_at: job.started_at.toISOString(),
      };

      if (job.status === 'complete' && job.result_json) {
        const result = JSON.parse(job.result_json);
        response.sent = result.sent;
        response.recipients = result.recipients;
        response.emailsAnalyzed = result.emailsAnalyzed;
        response.completed_at = job.completed_at?.toISOString();
        response.success = true;
      } else if (job.status === 'failed') {
        response.error = job.error_message || 'Email generation failed';
        response.completed_at = job.completed_at?.toISOString();
        response.success = false;
      }

      return reply.code(200).send(response);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting email generation status');
      return reply.code(500).send({
        error: 'Failed to get status',
        message: error.message,
      });
    }
  });
}

/**
 * Run the inbox scan in the background.
 * Updates scan status as it progresses.
 */
async function runBackgroundScan(
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
async function runBackgroundExtraction(
  jobId: number,
  userId: string,
  auth: any,
  includedSenders: string[],
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    log.info({ jobId, userId, senderCount: includedSenders.length }, 'Background extraction: starting');

    // Dynamically import needed modules
    const { fetchRecentEmailsWithBody } = await import('../utils/inboxFetcher.js');
    const { extractEventsAndTodos } = await import('../parsers/eventTodoExtractor.js');
    const { clearFeedbackItems } = await import('../db/relevanceFeedbackDb.js');

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
 * Fetches emails, analyzes them, generates summary, and sends email.
 */
async function runBackgroundGenerateEmail(
  jobId: number,
  userId: string,
  auth: any,
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    log.info({ jobId, userId }, 'Background email generation: starting');

    // Dynamically import needed modules
    const { fetchAndStoreEmails } = await import('../utils/emailStorageService.js');
    const { analyzeUnanalyzedEmails } = await import('../parsers/twoPassAnalyzer.js');
    const { generatePersonalizedSummary } = await import('../utils/personalizedSummaryBuilder.js');
    const { renderPersonalizedEmail } = await import('../templates/personalizedEmailTemplate.js');
    const { sendInboxSummary } = await import('../utils/emailSender.js');
    const { createActionToken } = await import('../db/emailActionTokenDb.js');
    const { getOrCreateDefaultSettings } = await import('../db/settingsDb.js');

    // Step 1: Fetch and store emails from included senders (last 7 days)
    let senderQuery = '';
    if (hasSenderFilters(userId)) {
      const senders = getIncludedSenders(userId);
      if (senders.length > 0) {
        senderQuery = `{${senders.map(s => `from:${s}`).join(' OR ')}}`;
      }
    }

    log.info({ jobId, userId, hasSenderFilter: !!senderQuery }, 'Background email: fetching emails');
    const fetchResult = await fetchAndStoreEmails(userId, auth, 'last7days', 200, senderQuery);
    log.info({ jobId, userId, fetched: fetchResult.fetched, stored: fetchResult.stored }, 'Background email: emails fetched');

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

    const html = renderPersonalizedEmail(summaryWithActions);

    // Send to user's email
    const settings = getOrCreateDefaultSettings(userId);
    const recipients = settings.summary_email_recipients.length > 0
      ? settings.summary_email_recipients
      : [getUser(userId)?.email].filter(Boolean) as string[];

    const dummySummary = {
      email_analysis: { total_received: 0, signal_count: 0, noise_count: 0 },
      summary: [], kit_list: { tomorrow: [], upcoming: [] },
      financials: [], calendar_updates: [],
      attachments_requiring_review: [], recurring_activities: [],
      pro_dad_insight: '',
    };

    const sentCount = await sendInboxSummary(auth, dummySummary, html, recipients);

    log.info({ jobId, userId, sentCount, recipients }, 'Background email: sent successfully');

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
 * Run child profile analysis in the background.
 * Fetches emails and extracts child profiles using AI.
 */
async function runBackgroundAnalysis(
  jobId: number,
  userId: string,
  auth: any,
  provider: 'openai' | 'anthropic',
  schoolContext: Array<{ name: string; year_groups: string[] }> | undefined,
  log: any
): Promise<void> {
  try {
    updateJobStatus(jobId, 'scanning');
    console.log(`[ANALYZE ${jobId}] Starting - fetching emails`);
    log.info({ jobId, userId, provider }, 'Background analysis: starting');

    // Build sender filter query from included senders
    const includedSenders = getIncludedSenders(userId);
    let senderQuery = '';
    if (includedSenders.length > 0) {
      senderQuery = includedSenders.map(s => `from:${s}`).join(' OR ');
      senderQuery = `{${senderQuery}}`;
    }

    // Fetch emails (reduced from 100 to 50 to avoid timeouts)
    log.info({ jobId, userId, senderCount: includedSenders.length }, 'Background analysis: fetching emails');
    const rawEmails = await fetchRecentEmailsWithBody(auth, 'last30days', 50, senderQuery);

    console.log(`[ANALYZE ${jobId}] Fetched ${rawEmails.length} emails`);
    log.info({ jobId, userId, emailCount: rawEmails.length }, 'Background analysis: emails fetched');

    if (rawEmails.length === 0) {
      // Complete with empty result
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

    // Map to format expected by extractChildProfiles
    const emails = rawEmails.map(e => ({
      ...e,
      bodyText: e.body,
    }));

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
