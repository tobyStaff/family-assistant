// src/routes/settingsRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { upsertSettings, getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { getUser } from '../db/userDb.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderSettingsContent, renderSettingsScripts } from '../templates/settingsContent.js';

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

        // Generate settings content
        const content = renderSettingsContent({
          summaryEmailRecipients: settings.summary_email_recipients,
          summaryEnabled: settings.summary_enabled,
          summaryTimeUtc: settings.summary_time_utc,
          timezone: settings.timezone,
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
}
