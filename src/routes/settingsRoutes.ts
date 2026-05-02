// src/routes/settingsRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  upsertSettings,
  getOrCreateDefaultSettings,
} from '../db/settingsDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { requireAdmin } from '../middleware/authorization.js';
import {
  getUser,
  isHostedAliasAvailable,
  validateHostedAlias,
  setHostedEmailAlias,
  getHostedEmailAlias,
  getHostedEmailAddress,
  getHostedEmailDomain,
  isCalendarConnected,
  setCalendarConnected,
} from '../db/userDb.js';
import type { Role } from '../types/roles.js';
import { isAdmin } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderSettingsContent, renderSettingsScripts } from '../templates/settingsContent.js';
import { getSubscription, ensureSubscription } from '../db/subscriptionDb.js';
import { TIER_CONFIGS } from '../config/tiers.js';
import { renderSendersContent, renderSendersScripts } from '../templates/sendersContent.js';
import { renderRelevanceTrainingContent, renderRelevanceTrainingScripts } from '../templates/relevanceTrainingContent.js';

/**
 * Zod schema for PUT /settings request validation
 */
const UpdateSettingsSchema = z.object({
  summaryEmailRecipients: z.array(z.string().email()).optional(),
  summaryEnabled: z.boolean().optional(),
  summaryTimeUtc: z.number().int().min(6).max(10).optional(),
  timezone: z.string().optional(),
});

/**
 * Register settings-related routes
 *
 * @param fastify - Fastify instance
 */
export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /settings
   * Get current user settings (HTML UI or JSON API)
   */
  fastify.get('/settings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const user = getUser(userId);
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

      // Get settings or return defaults if not found
      const settings = getOrCreateDefaultSettings(userId);

      // Check if request wants HTML (browser) or JSON (API)
      const acceptHeader = request.headers.accept || '';
      const wantsHtml = acceptHeader.includes('text/html');

      if (wantsHtml) {
        // Check for impersonation
        const impersonatingUserId = (request as any).impersonatingUserId;
        const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

        // Get hosted email info (hosted is the only source)
        const hostedAlias = getHostedEmailAlias(userId);
        const hostedEmail = hostedAlias ? getHostedEmailAddress(userId) : null;

        // Get calendar connection status
        const calendarConnected = isCalendarConnected(userId);

        // Get subscription info
        const subscription = getSubscription(userId) || ensureSubscription(userId);
        const tierConfig = TIER_CONFIGS[subscription.tier];

        // Generate settings content
        const content = renderSettingsContent({
          summaryEmailRecipients: settings.summary_email_recipients,
          summaryEnabled: settings.summary_enabled,
          summaryTimeUtc: settings.summary_time_utc,
          timezone: settings.timezone,
          hostedAlias,
          hostedEmail,
          hostedDomain: getHostedEmailDomain(),
          userIsAdmin: isAdmin(userRoles),
          calendarConnected,
          subscription: {
            tier: subscription.tier,
            tierDisplayName: tierConfig.displayName,
            priceFormatted: tierConfig.priceFormatted,
            status: subscription.status,
            features: tierConfig.features,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            trialEnd: subscription.trialEnd?.toISOString() || null,
            hasStripeSubscription: Boolean(subscription.stripeSubscriptionId),
          },
        });

        const scripts = renderSettingsScripts(settings.summary_email_recipients);

        // Render with layout
        const html = renderLayout({
          title: 'Settings',
          currentPath: '/settings',
          user: {
            name: user?.name,
            email: user?.email || 'Unknown',
            picture_url: user?.picture_url,
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
      } else {
        // Return JSON for API requests
        return reply.code(200).send({
          summaryEmailRecipients: settings.summary_email_recipients,
          summaryEnabled: settings.summary_enabled,
          summaryTimeUtc: settings.summary_time_utc,
          timezone: settings.timezone,
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error getting settings');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * PUT /settings
   * Update user settings
   */
  fastify.put<{
    Body: z.infer<typeof UpdateSettingsSchema>;
  }>('/settings', { preHandler: requireAuth }, async (request, reply) => {
    // Validate body
    const bodyResult = UpdateSettingsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);

      // Get existing settings or defaults
      const currentSettings = getOrCreateDefaultSettings(userId);

      // Merge with new values
      const updatedSettings = {
        user_id: userId,
        summary_email_recipients: bodyResult.data.summaryEmailRecipients ?? currentSettings.summary_email_recipients,
        summary_enabled: bodyResult.data.summaryEnabled ?? currentSettings.summary_enabled,
        summary_time_utc: bodyResult.data.summaryTimeUtc ?? currentSettings.summary_time_utc,
        timezone: bodyResult.data.timezone ?? currentSettings.timezone,
      };

      // Save to database
      upsertSettings(updatedSettings);

      fastify.log.info({ userId }, 'Settings updated successfully');

      return reply.code(200).send({
        success: true,
        message: 'Settings updated',
        settings: {
          summaryEmailRecipients: updatedSettings.summary_email_recipients,
          summaryEnabled: updatedSettings.summary_enabled,
          summaryTimeUtc: updatedSettings.summary_time_utc,
          timezone: updatedSettings.timezone,
        },
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating settings');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  // ============================================
  // HOSTED ALIAS ENDPOINTS
  // ============================================

  /**
   * POST /api/settings/alias
   * Claim or rename the hosted email alias.
   */
  fastify.post<{
    Body: { alias: string };
  }>('/api/settings/alias', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
      const { alias } = request.body;

      if (!alias) {
        return reply.code(400).send({ error: 'Alias is required' });
      }

      const validation = validateHostedAlias(alias);
      if (!validation.valid) {
        return reply.code(400).send({ error: validation.error });
      }

      const currentAlias = getHostedEmailAlias(userId);
      if (currentAlias?.toLowerCase() !== alias.toLowerCase()) {
        // Once an alias is claimed, only admins can change it.
        if (currentAlias && !isAdmin(userRoles)) {
          return reply.code(403).send({
            error: 'Your forwarding address can\'t be changed once set. Contact support if you need to update it.',
          });
        }
        if (!isHostedAliasAvailable(alias)) {
          return reply.code(409).send({ error: 'This alias is already taken' });
        }
        const success = setHostedEmailAlias(userId, alias);
        if (!success) {
          return reply.code(409).send({ error: 'Failed to claim alias. It may have been taken.' });
        }
        fastify.log.info({ userId, alias, byAdmin: !!currentAlias }, 'Hosted email alias claimed/changed');
      }

      const hostedEmail = getHostedEmailAddress(userId);

      return reply.code(200).send({
        success: true,
        hostedAlias: alias,
        hostedEmail,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating alias');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/settings/check-alias
   * Check if a hosted email alias is available
   */
  fastify.get<{
    Querystring: { alias?: string };
  }>('/api/settings/check-alias', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const alias = request.query.alias?.toLowerCase().trim();

      if (!alias) {
        return reply.code(400).send({ error: 'Alias parameter is required' });
      }

      // Validate format first
      const validation = validateHostedAlias(alias);
      if (!validation.valid) {
        return reply.code(200).send({
          alias,
          available: false,
          reason: validation.error,
        });
      }

      // Check if user already owns this alias
      const currentAlias = getHostedEmailAlias(userId);
      if (currentAlias?.toLowerCase() === alias.toLowerCase()) {
        return reply.code(200).send({
          alias,
          available: true,
          owned: true,
          reason: 'You already own this alias',
        });
      }

      // Check availability
      const available = isHostedAliasAvailable(alias);

      return reply.code(200).send({
        alias,
        available,
        owned: false,
        reason: available ? undefined : 'Already taken',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error checking alias availability');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ============================================
  // CALENDAR INTEGRATION ENDPOINTS
  // ============================================

  /**
   * POST /api/settings/disconnect-calendar
   * Disconnect Google Calendar integration
   */
  fastify.post('/api/settings/disconnect-calendar', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      setCalendarConnected(userId, false);
      fastify.log.info({ userId }, 'User disconnected Google Calendar');

      return reply.code(200).send({
        success: true,
        message: 'Google Calendar disconnected',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error disconnecting calendar');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ============================================
  // SENDERS MANAGEMENT PAGE
  // ============================================

  /**
   * GET /settings/senders
   * Dedicated page for managing sender filters
   */
  fastify.get('/settings/senders', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const user = getUser(userId);
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

      // Check for impersonation
      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      const content = renderSendersContent();
      const scripts = renderSendersScripts();

      const html = renderLayout({
        title: 'Monitored Senders',
        currentPath: '/settings',
        user: {
          name: user?.name,
          email: user?.email || 'Unknown',
          picture_url: user?.picture_url,
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
    } catch (error) {
      fastify.log.error({ err: error }, 'Error loading senders page');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /settings/training
   * Dedicated page for relevance training
   */
  fastify.get('/settings/training', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const user = getUser(userId);
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

      // Check for impersonation
      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      const content = renderRelevanceTrainingContent();
      const scripts = renderRelevanceTrainingScripts();

      const html = renderLayout({
        title: 'Relevance Training',
        currentPath: '/settings',
        user: {
          name: user?.name,
          email: user?.email || 'Unknown',
          picture_url: user?.picture_url,
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
    } catch (error) {
      fastify.log.error({ err: error }, 'Error loading training page');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
