// src/routes/childProfileRoutes.ts

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { fetchRecentEmails } from '../utils/inboxFetcher.js';
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

/**
 * Zod schema for running onboarding analysis
 */
const OnboardingAnalysisSchema = z.object({
  aiProvider: z.enum(['openai', 'anthropic']).optional(),
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

      // Fetch last 90 days of school emails
      const emails = await fetchRecentEmails(auth, 'last90days', 200);

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
      const result = await extractChildProfiles(emails, provider);

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
}
