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
   * Analyze emails to extract child profile information
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
      const auth = await getUserAuth(request);
      const provider = bodyResult.data.aiProvider || 'openai';

      fastify.log.info({ userId, provider }, 'Starting onboarding analysis');

      // Build sender filter query from included senders
      const includedSenders = getIncludedSenders(userId);
      let senderQuery = '';
      if (includedSenders.length > 0) {
        // Gmail "from:" OR query: from:a@b.com OR from:c@d.com
        senderQuery = includedSenders.map(s => `from:${s}`).join(' OR ');
        senderQuery = `{${senderQuery}}`;
      }

      // Fetch last 90 days of emails with full body, filtered by included senders
      fastify.log.info({ userId, includedSenders: includedSenders.length, senderQuery }, 'Fetching emails for analysis');
      const rawEmails = await fetchRecentEmailsWithBody(auth, 'last90days', 100, senderQuery);

      // Map to EmailMetadata with body text
      const emails = rawEmails.map(e => ({
        ...e,
        bodyText: e.body,
      }));

      fastify.log.info(
        { userId, emailCount: emails.length },
        'Fetched emails for analysis'
      );

      if (emails.length === 0) {
        return reply.code(200).send({
          success: true,
          message: 'No emails found in the last 90 days',
          result: {
            children: [],
            schools_detected: [],
            email_count_analyzed: 0,
            date_range: {
              from: new Date().toISOString(),
              to: new Date().toISOString(),
            },
          },
        });
      }

      // Extract child profiles using AI
      const result = await extractChildProfiles(emails, provider, bodyResult.data.schoolContext);

      fastify.log.info(
        {
          userId,
          childrenFound: result.children.length,
          schoolsFound: result.schools_detected.length,
        },
        'Onboarding analysis completed'
      );

      return reply.code(200).send({
        success: true,
        result,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error in onboarding analysis');
      return reply.code(500).send({
        error: 'Failed to analyze emails',
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
   * Scan inbox for unique senders to build include/exclude list.
   * Two-pass approach:
   *   Pass 1 (default): category:primary — personal/school emails
   *   Pass 2 (broadSearch=true): category:updates — newsletters, school bulletins
   * Paginates through all emails in the date range to discover every sender.
   */
  fastify.post<{
    Body: { broadSearch?: boolean };
  }>('/onboarding/scan-inbox', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      // Fetch both primary and updates in a single pass so AI ranking covers all senders
      const categoryFilter = '{category:primary category:updates}';

      fastify.log.info({ userId, categoryFilter }, 'Scanning inbox for senders');

      const senders = await fetchAllSenders(auth, 'last30days', categoryFilter, 500);

      fastify.log.info(
        { userId, uniqueSenders: senders.length },
        'Inbox scan complete'
      );

      // Rank senders by AI relevance
      const rankedSenders = await rankSenderRelevance(senders);

      fastify.log.info(
        { userId, rankedCount: rankedSenders.length },
        'Sender relevance ranking complete'
      );

      return reply.code(200).send({
        success: true,
        senders: rankedSenders,
        total_emails: rankedSenders.reduce((sum, s) => sum + s.count, 0),
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error scanning inbox');
      return reply.code(500).send({
        error: 'Failed to scan inbox',
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
   * Extract todos/events from approved senders for user to grade
   */
  fastify.post('/onboarding/extract-for-training', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      fastify.log.info({ userId }, 'Extracting items for relevance training');

      // Get included senders
      const includedSenders = getIncludedSenders(userId);
      if (includedSenders.length === 0) {
        return reply.code(400).send({
          error: 'No senders selected',
          message: 'Please select senders first',
        });
      }

      // Clear any existing feedback items for fresh extraction
      clearFeedbackItems(userId);

      // Build sender filter query
      const senderQuery = `{${includedSenders.map(s => `from:${s}`).join(' OR ')}}`;

      // Fetch emails from included senders (last 30 days, limit 20)
      const rawEmails = await fetchRecentEmailsWithBody(auth, 'last30days', 20, senderQuery);

      if (rawEmails.length === 0) {
        return reply.code(200).send({
          success: true,
          message: 'No emails found from selected senders',
          items: [],
        });
      }

      fastify.log.info({ userId, emailCount: rawEmails.length }, 'Fetched emails for training extraction');

      // Extract todos and events using existing extractor
      const { extractEventsAndTodos } = await import('../parsers/eventTodoExtractor.js');

      const feedbackItems: { user_id: string; item_type: 'todo' | 'event'; item_text: string; source_sender?: string; source_subject?: string }[] = [];

      for (const email of rawEmails) {
        try {
          const result = await extractEventsAndTodos(
            [{ ...email, bodyText: email.body }],
            'openai'
          );

          // Add extracted todos
          for (const todo of result.todos) {
            feedbackItems.push({
              user_id: userId,
              item_type: 'todo',
              item_text: `[${todo.type}] ${todo.description}${todo.due_date ? ` (Due: ${todo.due_date})` : ''}`,
              source_sender: email.from,
              source_subject: email.subject,
            });
          }

          // Add extracted events
          for (const event of result.events) {
            feedbackItems.push({
              user_id: userId,
              item_type: 'event',
              item_text: `${event.title} - ${event.date}${event.location ? ` @ ${event.location}` : ''}`,
              source_sender: email.from,
              source_subject: email.subject,
            });
          }
        } catch (err: any) {
          fastify.log.warn({ err: err.message, emailId: email.id }, 'Failed to extract from email');
        }
      }

      // Store feedback items
      if (feedbackItems.length > 0) {
        insertFeedbackItemsBatch(feedbackItems);
      }

      fastify.log.info({ userId, itemCount: feedbackItems.length }, 'Extracted items for training');

      // Return the items for grading
      const items = getUngradedFeedbackItems(userId);

      return reply.code(200).send({
        success: true,
        items,
        emailsProcessed: rawEmails.length,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error extracting items for training');
      return reply.code(500).send({
        error: 'Failed to extract items',
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
   * Generate and send the user's first daily briefing email
   */
  fastify.post('/onboarding/generate-first-email', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      fastify.log.info({ userId }, 'Generating first email during onboarding');

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
        const includedSenders = getIncludedSenders(userId);
        if (includedSenders.length > 0) {
          senderQuery = `{${includedSenders.map(s => `from:${s}`).join(' OR ')}}`;
        }
      }

      fastify.log.info({ userId, hasSenderFilter: !!senderQuery }, 'Fetching emails for first briefing');
      const fetchResult = await fetchAndStoreEmails(userId, auth, 'last7days', 200, senderQuery);
      fastify.log.info({ userId, fetched: fetchResult.fetched, stored: fetchResult.stored }, 'Emails fetched and stored');

      // Step 2: Analyze all unanalyzed emails
      const analysisResult = await analyzeUnanalyzedEmails(userId, 'openai', 50);
      fastify.log.info({ userId, processed: analysisResult.processed, todosCreated: analysisResult.todosCreated, eventsCreated: analysisResult.eventsCreated }, 'Emails analyzed');

      // Step 3: Generate summary
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

      fastify.log.info({ userId, sentCount, recipients }, 'First email sent during onboarding');

      return reply.code(200).send({
        success: true,
        message: `Email sent to ${recipients.join(', ')}`,
        sentCount,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error generating first email');
      return reply.code(500).send({
        error: 'Failed to generate first email',
        message: error.message,
      });
    }
  });
}
