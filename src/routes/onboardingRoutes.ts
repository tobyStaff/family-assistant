// src/routes/onboardingRoutes.ts
//
// Onboarding wizard routes (API endpoints + page views).
// Background job runners live in src/utils/onboardingJobs.ts.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { requireAdmin } from '../middleware/authorization.js';
import {
  getChildProfiles,
  getChildProfile,
  updateChildProfile,
  deleteChildProfile,
  hasCompletedOnboarding,
  createChildProfilesBatch,
} from '../db/childProfilesDb.js';
import type { ChildProfile } from '../types/childProfile.js';
import {
  upsertSenderFiltersBatch,
  upsertSenderFilter,
  getSenderFilters,
  getIncludedSenders,
  deleteSenderFilter,
} from '../db/senderFilterDb.js';
import {
  updateOnboardingStep,
  getUser,
  validateHostedAlias,
  isHostedAliasAvailable,
  setHostedEmailAlias,
  getHostedEmailAlias,
  getGmailConfirmationUrl,
} from '../db/userDb.js';
import { setEmailSource, getEmailSource } from '../db/settingsDb.js';
import { rerankSendersWithContext } from '../utils/senderRelevanceRanker.js';
import type { RankedSender } from '../utils/senderRelevanceRanker.js';
import {
  getFeedbackItems,
  updateFeedbackGradesBatch,
  getFeedbackStats,
  deleteFeedbackItem,
} from '../db/relevanceFeedbackDb.js';
import { updateSenderFilterScores, getLowRelevanceSenders } from '../utils/senderScoreCalculator.js';
import {
  createScan,
  createJob,
  getLatestScan,
  getLatestJob,
  isScanInProgress,
  isJobInProgress,
} from '../db/onboardingScanDb.js';
import {
  runBackgroundScan,
  runBackgroundExtraction,
  runBackgroundGenerateEmail,
  runBackgroundProcessHosted,
  runBackgroundAnalysis,
} from '../utils/onboardingJobs.js';
import { renderOnboardingPage } from '../templates/onboardingContent.js';
import { renderLayout } from '../templates/layout.js';
import { isAdmin } from '../types/roles.js';
import type { Role } from '../types/roles.js';

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
 * Register onboarding routes (page views + API endpoints)
 */
export async function onboardingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /onboarding
   * Onboarding wizard page
   */
  fastify.get('/onboarding', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const user = getUser(userId);
    let currentStep = user?.onboarding_step ?? 0;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const userIsAdmin = isAdmin(userRoles);
    const onboardingPath = currentStep > 0 ? getEmailSource(userId) : null;
    const hostedAlias = getHostedEmailAlias(userId);
    const hostedEmailAddress = hostedAlias ? `${hostedAlias}@inbox.getfamilyassistant.com` : 'your-alias@inbox.getfamilyassistant.com';
    const hostedConfirmationUrl = getGmailConfirmationUrl(userId);

    fastify.log.info({ userId, currentStep, gmailConnected: user?.gmail_connected, onboardingPath }, 'Loading onboarding page');

    // Verify OAuth tokens exist for Gmail path steps that require Gmail access
    const { getAuth } = await import('../db/authDb.js');
    const authEntry = getAuth(userId);
    const hasValidAuth = authEntry && authEntry.refresh_token;

    if (onboardingPath !== 'hosted' && currentStep >= 3 && !hasValidAuth) {
      // Gmail path: step 3 means Gmail should be connected. If auth is missing, reset to step 2.
      fastify.log.warn({ userId, currentStep }, 'Gmail user at step 3+ but missing OAuth tokens, resetting to step 2');
      updateOnboardingStep(userId, 2);
      currentStep = 2;
    }

    const html = renderOnboardingPage({
      currentStep,
      gmailConnected: user?.gmail_connected,
      onboardingPath,
      userIsAdmin,
      hostedAlias,
      hostedEmailAddress,
      hostedConfirmationUrl,
    });

    return reply.type('text/html').send(html);
  });

  /**
   * GET /child-profiles-manage
   * Child profiles management page
   */
  fastify.get('/child-profiles-manage', { preHandler: requireAuth }, async (request, reply) => {
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const user = getUser(realUserId);

    if (!user) {
      fastify.log.warn({ userId: realUserId }, 'User not found in database');
      return reply.redirect('/login');
    }

    // Check for impersonation
    const impersonatingUserId = (request as any).impersonatingUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

    // Import content templates
    const { renderChildProfilesContent, renderChildProfilesScripts } = await import('../templates/childProfilesContent.js');

    // Generate content
    const content = renderChildProfilesContent();
    const scripts = renderChildProfilesScripts();

    // Render with layout
    const html = renderLayout({
      title: 'Child Profiles',
      currentPath: '/child-profiles-manage',
      user: {
        name: user.name,
        email: user.email,
        picture_url: user.picture_url,
      },
      userRoles,
      impersonating: effectiveUser ? {
        email: effectiveUser.email,
        name: effectiveUser.name,
      } : null,
      content,
      scripts,
    });

    return reply.type('text/html').send(html);
  });

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

      const onboardingPath = getEmailSource(userId);
      const provider = bodyResult.data.aiProvider || 'openai';
      const schoolContext = bodyResult.data.schoolContext;

      // For hosted path, emails are already in DB — no Gmail auth needed
      let auth: any = null;
      if (onboardingPath !== 'hosted') {
        try {
          auth = await getUserAuth(request);
        } catch (authError: any) {
          return reply.code(401).send({
            error: 'Gmail not connected',
            message: authError.message,
          });
        }
      }

      // Create job record
      const jobId = createJob(userId, 'analyze_children');
      console.log(`[POST /analyze] Created job ${jobId} for user ${userId}`);
      fastify.log.info({ userId, jobId, onboardingPath }, 'Starting background child analysis');

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

      // Children confirmed — advance to step 2 (hosted: show alias; gmail: show connect gmail)
      updateOnboardingStep(userId, 2);

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
   * POST /onboarding/choose-path
   * Select onboarding path: 'hosted' or 'gmail'
   */
  fastify.post<{
    Body: { path: 'hosted' | 'gmail' };
  }>('/onboarding/choose-path', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { path } = request.body;

      if (path !== 'hosted' && path !== 'gmail') {
        return reply.code(400).send({ error: 'path must be "hosted" or "gmail"' });
      }

      setEmailSource(userId, path);
      updateOnboardingStep(userId, 1);

      fastify.log.info({ userId, path }, 'Onboarding path selected');
      return reply.code(200).send({ success: true });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error choosing onboarding path');
      return reply.code(500).send({ error: 'Failed to set path', message: error.message });
    }
  });

  /**
   * POST /onboarding/set-alias
   * Set hosted email alias for the user
   */
  fastify.post<{
    Body: { alias: string };
  }>('/onboarding/set-alias', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { alias } = request.body;

      const validation = validateHostedAlias(alias);
      if (!validation.valid) {
        return reply.code(400).send({ error: validation.error });
      }

      if (!isHostedAliasAvailable(alias)) {
        return reply.code(409).send({ error: 'This alias is already taken' });
      }

      const success = setHostedEmailAlias(userId, alias);
      if (!success) {
        return reply.code(409).send({ error: 'This alias is already taken' });
      }

      updateOnboardingStep(userId, 3);

      const email = `${alias.toLowerCase()}@inbox.getfamilyassistant.com`;
      fastify.log.info({ userId, alias, email }, 'Hosted email alias set');
      return reply.code(200).send({ success: true, email });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error setting hosted alias');
      return reply.code(500).send({ error: 'Failed to set alias', message: error.message });
    }
  });

  /**
   * GET /onboarding/hosted-email-count
   * Get count of hosted emails received for the user
   */
  fastify.get('/onboarding/hosted-email-count', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { default: db } = await import('../db/db.js');
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM emails WHERE user_id = ? AND source_type = 'hosted'`
      ).get(userId) as { count: number };

      const count = row?.count ?? 0;

      const confirmationUrl = getGmailConfirmationUrl(userId);

      return reply.code(200).send({ count, ready: count >= 3, confirmationUrl });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting hosted email count');
      return reply.code(500).send({ error: 'Failed to get email count', message: error.message });
    }
  });

  /**
   * POST /onboarding/process-hosted-emails
   * Start background processing of hosted emails
   */
  fastify.post('/onboarding/process-hosted-emails', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      if (isJobInProgress(userId, 'process_hosted')) {
        return reply.code(200).send({
          success: true,
          status: 'scanning',
          message: 'Processing already in progress',
        });
      }

      const jobId = createJob(userId, 'process_hosted');
      fastify.log.info({ userId, jobId }, 'Starting background hosted email processing');

      runBackgroundProcessHosted(jobId, userId, fastify.log).catch(err => {
        fastify.log.error({ err, jobId, userId }, 'Background hosted email processing failed');
      });

      return reply.code(202).send({
        success: true,
        status: 'scanning',
        message: 'Processing started. Poll /onboarding/process-hosted-emails/status for results.',
        jobId,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error starting hosted email processing');
      return reply.code(500).send({ error: 'Failed to start processing', message: error.message });
    }
  });

  /**
   * GET /onboarding/process-hosted-emails/status
   * Check status of hosted email processing job
   */
  fastify.get('/onboarding/process-hosted-emails/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const job = getLatestJob(userId, 'process_hosted');

      if (!job) {
        return reply.code(404).send({
          error: 'No processing job found',
          message: 'No processing has been started.',
        });
      }

      const response: any = {
        status: job.status,
        started_at: job.started_at.toISOString(),
      };

      if (job.status === 'complete' && job.result_json) {
        const result = JSON.parse(job.result_json);
        response.emailCount = result.emailCount;
        response.completed_at = job.completed_at?.toISOString();
        response.success = true;
      } else if (job.status === 'failed') {
        response.error = job.error_message || 'Processing failed';
        response.completed_at = job.completed_at?.toISOString();
        response.success = false;
      }

      return reply.code(200).send(response);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting processing status');
      return reply.code(500).send({ error: 'Failed to get status', message: error.message });
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
  fastify.get('/api/relevance-feedback', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/relevance-feedback/:id', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/relevance-feedback/:id', { preHandler: requireAdmin }, async (request, reply) => {
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
  fastify.get('/api/sender-filters', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/sender-filters', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/sender-filters/:email', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/sender-filters/:email', { preHandler: requireAdmin }, async (request, reply) => {
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
  }>('/api/sender-warnings', { preHandler: requireAdmin }, async (request, reply) => {
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

      const onboardingPath = getEmailSource(userId);

      // For hosted path, no Gmail auth needed — emails already in DB
      let auth: any = null;
      if (onboardingPath !== 'hosted') {
        try {
          auth = await getUserAuth(request);
        } catch (authError: any) {
          return reply.code(401).send({
            error: 'Gmail not connected',
            message: authError.message,
          });
        }
      }

      // Create job record
      const jobId = createJob(userId, 'generate_email');
      fastify.log.info({ userId, jobId, onboardingPath }, 'Starting background email generation');

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
