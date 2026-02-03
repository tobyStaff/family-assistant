// src/routes/settingsRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  upsertSettings,
  getOrCreateDefaultSettings,
  getEmailSource,
  setEmailSource,
  type EmailSource,
} from '../db/settingsDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import {
  getUser,
  isHostedAliasAvailable,
  validateHostedAlias,
  setHostedEmailAlias,
  clearHostedEmailAlias,
  getHostedEmailAlias,
  getHostedEmailAddress,
  getHostedEmailDomain,
} from '../db/userDb.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderSettingsContent, renderSettingsScripts } from '../templates/settingsContent.js';
import { renderSendersContent, renderSendersScripts } from '../templates/sendersContent.js';
import { renderRelevanceTrainingContent, renderRelevanceTrainingScripts } from '../templates/relevanceTrainingContent.js';

/**
 * Zod schema for PUT /settings request validation
 */
const UpdateSettingsSchema = z.object({
  summaryEmailRecipients: z.array(z.string().email()).optional(),
  summaryEnabled: z.boolean().optional(),
  summaryTimeUtc: z.number().int().min(0).max(23).optional(),
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

        // Get email source info
        const emailSource = getEmailSource(userId);
        const hostedAlias = getHostedEmailAlias(userId);
        const hostedEmail = hostedAlias ? getHostedEmailAddress(userId) : null;

        // Generate settings content
        const content = renderSettingsContent({
          summaryEmailRecipients: settings.summary_email_recipients,
          summaryEnabled: settings.summary_enabled,
          summaryTimeUtc: settings.summary_time_utc,
          timezone: settings.timezone,
          emailSource,
          hostedAlias,
          hostedEmail,
          hostedDomain: getHostedEmailDomain(),
        });

        const scripts = renderSettingsScripts(settings.summary_email_recipients, emailSource);

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
  // EMAIL SOURCE ENDPOINTS
  // ============================================

  /**
   * GET /api/settings/email-source
   * Get current email source configuration
   */
  fastify.get('/api/settings/email-source', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      const emailSource = getEmailSource(userId);
      const hostedAlias = getHostedEmailAlias(userId);
      const hostedEmail = hostedAlias ? getHostedEmailAddress(userId) : null;

      return reply.code(200).send({
        emailSource,
        hostedAlias,
        hostedEmail,
        hostedDomain: getHostedEmailDomain(),
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error getting email source');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/settings/email-source
   * Change email source (gmail or hosted)
   */
  fastify.post<{
    Body: { source: EmailSource; alias?: string };
  }>('/api/settings/email-source', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const { source, alias } = request.body;

      // Validate source
      if (source !== 'gmail' && source !== 'hosted') {
        return reply.code(400).send({ error: 'Invalid source. Must be "gmail" or "hosted"' });
      }

      if (source === 'hosted') {
        // Must provide alias when switching to hosted
        if (!alias) {
          return reply.code(400).send({ error: 'Alias is required when switching to hosted email' });
        }

        // Validate alias format
        const validation = validateHostedAlias(alias);
        if (!validation.valid) {
          return reply.code(400).send({ error: validation.error });
        }

        // Check availability (unless user already owns this alias)
        const currentAlias = getHostedEmailAlias(userId);
        if (currentAlias?.toLowerCase() !== alias.toLowerCase()) {
          if (!isHostedAliasAvailable(alias)) {
            return reply.code(409).send({ error: 'This alias is already taken' });
          }

          // Claim the alias
          const success = setHostedEmailAlias(userId, alias);
          if (!success) {
            return reply.code(409).send({ error: 'Failed to claim alias. It may have been taken.' });
          }
        }

        fastify.log.info({ userId, alias }, 'User claimed hosted email alias');
      } else {
        // Switching to Gmail - clear hosted alias
        clearHostedEmailAlias(userId);
        fastify.log.info({ userId }, 'User switched to Gmail, cleared hosted alias');
      }

      // Update email source preference
      setEmailSource(userId, source);

      const hostedEmail = source === 'hosted' ? getHostedEmailAddress(userId) : null;

      return reply.code(200).send({
        success: true,
        emailSource: source,
        hostedAlias: source === 'hosted' ? alias : null,
        hostedEmail,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating email source');
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

  /**
   * DELETE /api/settings/email-source/alias
   * Clear hosted email alias without switching source
   */
  fastify.delete('/api/settings/email-source/alias', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      const currentAlias = getHostedEmailAlias(userId);
      if (!currentAlias) {
        return reply.code(200).send({
          success: true,
          message: 'No alias to clear',
        });
      }

      clearHostedEmailAlias(userId);

      // Also switch back to Gmail
      setEmailSource(userId, 'gmail');

      fastify.log.info({ userId, clearedAlias: currentAlias }, 'User cleared hosted email alias');

      return reply.code(200).send({
        success: true,
        message: 'Alias cleared and switched to Gmail',
        clearedAlias: currentAlias,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error clearing alias');
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
  fastify.get('/settings/senders', { preHandler: requireAuth }, async (request, reply) => {
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
  fastify.get('/settings/training', { preHandler: requireAuth }, async (request, reply) => {
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
