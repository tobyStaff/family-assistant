// src/routes/attachmentRoutes.ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { saveAttachmentToDrive, getEmailAttachments } from '../utils/attachmentSaver.js';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Zod schema for attachment save request validation
 */
const SaveAttachmentParamsSchema = z.object({
  emailId: z.string().min(1, 'emailId is required'),
});

const SaveAttachmentBodySchema = z.object({
  attachmentId: z.string().min(1, 'attachmentId is required'),
  fileName: z.string().min(1, 'fileName is required'),
});

const ListAttachmentsParamsSchema = z.object({
  emailId: z.string().min(1, 'emailId is required'),
});

/**
 * Get user's OAuth2 client from session/token
 * TODO: Implement this in deliverable 1/2 with actual OAuth flow
 *
 * @returns OAuth2Client for the authenticated user
 */
async function getUserAuth(_request: FastifyRequest): Promise<OAuth2Client> {
  // TODO: Replace with actual auth implementation
  // This should:
  // 1. Get user ID from JWT/session
  // 2. Fetch encrypted OAuth tokens from database
  // 3. Decrypt tokens using crypto module
  // 4. Create and return OAuth2Client with tokens
  throw new Error('Auth not implemented - placeholder for deliverable 1/2');
}

/**
 * Register attachment-related routes
 *
 * @param fastify - Fastify instance
 */
export async function attachmentRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /save-attachment/:emailId
   * Save a single attachment from Gmail to Drive using streaming
   */
  fastify.post<{
    Params: z.infer<typeof SaveAttachmentParamsSchema>;
    Body: z.infer<typeof SaveAttachmentBodySchema>;
  }>('/save-attachment/:emailId', async (request, reply) => {
    // Validate params
    const paramsResult = SaveAttachmentParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    // Validate body
    const bodyResult = SaveAttachmentBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        details: bodyResult.error.issues,
      });
    }

    try {
      // Get user's OAuth client
      const auth = await getUserAuth(request);

      // Save attachment using streaming
      const fileId = await saveAttachmentToDrive(auth, {
        emailId: paramsResult.data.emailId,
        attachmentId: bodyResult.data.attachmentId,
        fileName: bodyResult.data.fileName,
      });

      if (!fileId) {
        return reply.code(500).send({
          error: 'Failed to save attachment',
        });
      }

      return reply.code(200).send({
        success: true,
        fileId,
        message: 'Attachment saved to Drive',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error saving attachment');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /attachments/:emailId
   * List all attachments in an email without downloading them
   */
  fastify.get<{
    Params: z.infer<typeof ListAttachmentsParamsSchema>;
  }>('/attachments/:emailId', async (request, reply) => {
    // Validate params
    const paramsResult = ListAttachmentsParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    try {
      // Get user's OAuth client
      const auth = await getUserAuth(request);

      // Get attachment list
      const attachments = await getEmailAttachments(
        auth,
        paramsResult.data.emailId
      );

      return reply.code(200).send({
        emailId: paramsResult.data.emailId,
        attachments,
        count: attachments.length,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error listing attachments');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });
}
