// src/routes/onboardingRoutes.ts
//
// Onboarding wizard (alias → children → forward) plus CRUD endpoints used
// by the post-onboarding settings pages (child profiles, sender filters,
// relevance feedback).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { requireAdmin } from '../middleware/authorization.js';
import {
  getChildProfiles,
  getChildProfile,
  updateChildProfile,
  deleteChildProfile,
  createChildProfile,
  createChildProfilesBatch,
} from '../db/childProfilesDb.js';
import type { ChildProfile } from '../types/childProfile.js';
import {
  upsertSenderFilter,
  getSenderFilters,
  deleteSenderFilter,
} from '../db/senderFilterDb.js';
import {
  getUser,
  validateHostedAlias,
  isHostedAliasAvailable,
  setHostedEmailAlias,
  getHostedEmailAddress,
  getHostedEmailDomain,
} from '../db/userDb.js';
import {
  getFeedbackItems,
  updateFeedbackGradesBatch,
  getFeedbackStats,
  deleteFeedbackItem,
} from '../db/relevanceFeedbackDb.js';
import { updateSenderFilterScores, getLowRelevanceSenders } from '../utils/senderScoreCalculator.js';
import {
  getNextOnboardingStep,
  isOnboardingComplete,
  ONBOARDING_FLOW_ORDER,
  type OnboardingFlowStep,
} from '../lib/onboardingState.js';
import { renderOnboardingPage } from '../templates/onboardingContent.js';
import { renderLayout } from '../templates/layout.js';
import type { Role } from '../types/roles.js';

const DEV_SKIP_COOKIE = 'dev_skip_onboarding';
const isDevEnv = process.env.NODE_ENV !== 'production';

export function readDevSkipCookie(request: { cookies?: Record<string, string | undefined> }): Set<OnboardingFlowStep> {
  if (!isDevEnv) return new Set();
  const raw = request.cookies?.[DEV_SKIP_COOKIE];
  if (!raw) return new Set();
  const valid = new Set(ONBOARDING_FLOW_ORDER as readonly string[]);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OnboardingFlowStep => valid.has(s))
  );
}

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

const UpdateProfileSchema = z.object({
  real_name: z.string().min(1).optional(),
  display_name: z.string().optional(),
  year_group: z.string().optional(),
  school_name: z.string().optional(),
  class_name: z.string().optional(),
  clubs: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const CreateProfileSchema = z.object({
  real_name: z.string().min(1),
  display_name: z.string().optional(),
  year_group: z.string().optional(),
  school_name: z.string().optional(),
  class_name: z.string().optional(),
  clubs: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export async function onboardingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /onboarding
   * Renders whichever step the user is currently missing. Sends fully-onboarded
   * users to /dashboard so they can't get stuck looping back into the wizard.
   */
  fastify.get('/onboarding', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).userId;
    const skip = readDevSkipCookie(request as any);
    const step = getNextOnboardingStep(userId, skip);

    if (step === 'done') {
      return reply.redirect('/dashboard');
    }

    fastify.log.info({ userId, step, skipped: [...skip] }, 'Rendering onboarding step');

    const html = renderOnboardingPage({
      step,
      hostedEmailDomain: getHostedEmailDomain(),
      hostedEmailAddress: getHostedEmailAddress(userId),
      isDev: isDevEnv,
    });

    return reply.type('text/html').send(html);
  });

  /**
   * POST /onboarding/dev-skip
   * Adds the given step to the dev_skip_onboarding cookie. Dev only.
   * The cookie is cleared on next login (see authRoutes callback) so
   * skips do not persist across sessions.
   */
  fastify.post<{ Body: { step: string } }>(
    '/onboarding/dev-skip',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!isDevEnv) {
        return reply.code(404).send({ error: 'Not available in production' });
      }
      const stepToSkip = request.body?.step;
      if (!stepToSkip || !(ONBOARDING_FLOW_ORDER as readonly string[]).includes(stepToSkip)) {
        return reply.code(400).send({ error: 'Invalid step' });
      }

      const existing = readDevSkipCookie(request as any);
      existing.add(stepToSkip as OnboardingFlowStep);
      const value = [...existing].join(',');

      (reply as any).setCookie(DEV_SKIP_COOKIE, value, {
        httpOnly: true,
        secure: false, // dev only
        sameSite: 'lax',
        path: '/',
      });

      return reply.code(200).send({ success: true, skipped: [...existing] });
    }
  );

  /**
   * POST /onboarding/set-alias
   */
  fastify.post<{ Body: { alias: string } }>(
    '/onboarding/set-alias',
    { preHandler: requireAuth },
    async (request, reply) => {
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

        const email = `${alias.toLowerCase()}@${getHostedEmailDomain()}`;
        fastify.log.info({ userId, alias, email }, 'Hosted email alias set');
        return reply.code(200).send({ success: true, email });
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Error setting hosted alias');
        return reply.code(500).send({ error: 'Failed to set alias', message: error.message });
      }
    }
  );

  /**
   * POST /onboarding/confirm
   * Save child profiles entered during the children step.
   */
  fastify.post<{ Body: z.infer<typeof ConfirmOnboardingSchema> }>(
    '/onboarding/confirm',
    { preHandler: requireAuth },
    async (request, reply) => {
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

        const ids = createChildProfilesBatch(profiles);

        fastify.log.info({ userId, profileCount: ids.length }, 'Child profiles created');

        return reply.code(200).send({
          success: true,
          message: `${ids.length} child profile(s) created successfully`,
          profile_ids: ids,
        });
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Error creating child profiles');
        return reply.code(500).send({ error: 'Failed to create profiles', message: error.message });
      }
    }
  );

  /**
   * GET /onboarding/hosted-email-count
   * Used by the forward-emails screen to detect when the first email arrives.
   */
  fastify.get('/onboarding/hosted-email-count', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { default: db } = await import('../db/db.js');
      const row = db
        .prepare(`SELECT COUNT(*) as count FROM emails WHERE user_id = ?`)
        .get(userId) as { count: number };
      return reply.code(200).send({ count: row?.count ?? 0 });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting hosted email count');
      return reply.code(500).send({ error: 'Failed to get email count', message: error.message });
    }
  });

  /**
   * GET /onboarding/status
   * Boolean check used by other code to gate features behind onboarding completion.
   */
  fastify.get('/onboarding/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      return reply.code(200).send({ onboarding_completed: isOnboardingComplete(userId) });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error checking onboarding status');
      return reply.code(500).send({ error: 'Failed to check status', message: error.message });
    }
  });

  // ============================================
  // CHILD PROFILES — CRUD (used by settings page)
  // ============================================

  /**
   * GET /child-profiles-manage
   * Settings page for editing child profiles after onboarding.
   */
  fastify.get('/child-profiles-manage', { preHandler: requireAuth }, async (request, reply) => {
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const user = getUser(realUserId);

    if (!user) {
      fastify.log.warn({ userId: realUserId }, 'User not found in database');
      return reply.redirect('/login');
    }

    const impersonatingUserId = (request as any).impersonatingUserId;
    const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

    const { renderChildProfilesContent, renderChildProfilesScripts } = await import(
      '../templates/childProfilesContent.js'
    );

    const content = renderChildProfilesContent();
    const scripts = renderChildProfilesScripts();

    const html = renderLayout({
      title: 'Child Profiles',
      currentPath: '/child-profiles-manage',
      user: {
        name: user.name,
        email: user.email,
        picture_url: user.picture_url,
      },
      userRoles,
      impersonating: effectiveUser ? { email: effectiveUser.email, name: effectiveUser.name } : null,
      content,
      scripts,
    });

    return reply.type('text/html').send(html);
  });

  fastify.get('/child-profiles', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const profiles = getChildProfiles(userId);
      return reply.code(200).send({ profiles });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching child profiles');
      return reply.code(500).send({ error: 'Failed to fetch profiles', message: error.message });
    }
  });

  fastify.post<{ Body: z.infer<typeof CreateProfileSchema> }>(
    '/child-profiles',
    { preHandler: requireAuth },
    async (request, reply) => {
      const bodyResult = CreateProfileSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: bodyResult.error.issues });
      }

      try {
        const userId = getUserId(request);
        const profile: ChildProfile = {
          user_id: userId,
          real_name: bodyResult.data.real_name,
          display_name: bodyResult.data.display_name,
          year_group: bodyResult.data.year_group,
          school_name: bodyResult.data.school_name,
          class_name: bodyResult.data.class_name,
          clubs: bodyResult.data.clubs,
          notes: bodyResult.data.notes,
          is_active: true,
          onboarding_completed: true,
        };
        const id = createChildProfile(profile);
        fastify.log.info({ userId, profileId: id }, 'Child profile created');
        return reply.code(201).send({ success: true, id });
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Error creating child profile');
        return reply.code(500).send({ error: 'Failed to create profile', message: error.message });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/child-profiles/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const profileId = parseInt(request.params.id, 10);

        if (isNaN(profileId)) {
          return reply.code(400).send({ error: 'Invalid profile ID' });
        }

        const profile = getChildProfile(userId, profileId);
        if (!profile) {
          return reply.code(404).send({ error: 'Profile not found' });
        }

        return reply.code(200).send({ profile });
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Error fetching child profile');
        return reply.code(500).send({ error: 'Failed to fetch profile', message: error.message });
      }
    }
  );

  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof UpdateProfileSchema>;
  }>('/child-profiles/:id', { preHandler: requireAuth }, async (request, reply) => {
    const bodyResult = UpdateProfileSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: bodyResult.error.issues });
    }

    try {
      const userId = getUserId(request);
      const profileId = parseInt(request.params.id, 10);

      if (isNaN(profileId)) {
        return reply.code(400).send({ error: 'Invalid profile ID' });
      }

      const success = updateChildProfile(userId, profileId, bodyResult.data);
      if (!success) {
        return reply.code(404).send({ error: 'Profile not found' });
      }

      fastify.log.info({ userId, profileId }, 'Child profile updated');
      return reply.code(200).send({ success: true, message: 'Profile updated successfully' });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error updating child profile');
      return reply.code(500).send({ error: 'Failed to update profile', message: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>(
    '/child-profiles/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const profileId = parseInt(request.params.id, 10);

        if (isNaN(profileId)) {
          return reply.code(400).send({ error: 'Invalid profile ID' });
        }

        const success = deleteChildProfile(userId, profileId);
        if (!success) {
          return reply.code(404).send({ error: 'Profile not found' });
        }

        fastify.log.info({ userId, profileId }, 'Child profile deleted');
        return reply.code(200).send({ success: true, message: 'Profile deleted successfully' });
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Error deleting child profile');
        return reply.code(500).send({ error: 'Failed to delete profile', message: error.message });
      }
    }
  );

  // ============================================
  // SENDER FILTER MANAGEMENT (admin settings page)
  // ============================================

  fastify.get('/api/sender-filters', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const filters = getSenderFilters(userId);
      return reply.code(200).send({ success: true, filters });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to fetch sender filters', message: error.message });
    }
  });

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
      return reply.code(200).send({ success: true });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to add sender filter', message: error.message });
    }
  });

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
      return reply.code(200).send({ success: true });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to update sender filter', message: error.message });
    }
  });

  fastify.delete<{ Params: { email: string } }>(
    '/api/sender-filters/:email',
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const email = decodeURIComponent(request.params.email).toLowerCase().trim();

        const deleted = deleteSenderFilter(userId, email);

        fastify.log.info({ userId, email, deleted }, 'Sender filter deleted');
        return reply.code(200).send({ success: deleted });
      } catch (error: any) {
        return reply.code(500).send({ error: 'Failed to delete sender filter', message: error.message });
      }
    }
  );

  fastify.get<{ Querystring: { threshold?: string } }>(
    '/api/sender-warnings',
    { preHandler: requireAdmin },
    async (request, reply) => {
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
        return reply.code(500).send({ error: 'Failed to fetch sender warnings', message: error.message });
      }
    }
  );

  // ============================================
  // RELEVANCE FEEDBACK (admin settings page)
  // ============================================

  fastify.get('/api/relevance-feedback', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const items = getFeedbackItems(userId);
      const stats = getFeedbackStats(userId);
      return reply.code(200).send({ success: true, items, stats });
    } catch (error: any) {
      return reply.code(500).send({ error: 'Failed to fetch feedback', message: error.message });
    }
  });

  fastify.put<{ Params: { id: string }; Body: { isRelevant: boolean } }>(
    '/api/relevance-feedback/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
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
        updateSenderFilterScores(userId);

        return reply.code(200).send({ success: updated > 0 });
      } catch (error: any) {
        return reply.code(500).send({ error: 'Failed to update feedback', message: error.message });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/relevance-feedback/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const userId = getUserId(request);
        const itemId = parseInt(request.params.id, 10);

        if (isNaN(itemId)) {
          return reply.code(400).send({ error: 'Invalid item ID' });
        }

        const deleted = deleteFeedbackItem(userId, itemId);
        return reply.code(200).send({ success: deleted });
      } catch (error: any) {
        return reply.code(500).send({ error: 'Failed to delete feedback item', message: error.message });
      }
    }
  );
}
