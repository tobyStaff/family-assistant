// src/routes/emailInboundRoutes.ts

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserByHostedAlias, setGmailConfirmationUrl } from '../db/userDb.js';
import {
  createEmail,
  emailExistsBySource,
  markEmailProcessed,
} from '../db/emailDb.js';
import {
  storeDownloadedAttachments,
  extractTextFromAttachment,
  buildAttachmentContentString,
  type DownloadedAttachment,
} from '../utils/attachmentExtractor.js';

const WEBHOOK_SECRET = process.env.HOSTED_EMAIL_WEBHOOK_SECRET;

/**
 * Schema for inbound email payload from Lambda
 */
const InboundEmailSchema = z.object({
  messageId: z.string(),
  recipient: z.string(),
  from: z.string(),
  fromName: z.string().optional(),
  subject: z.string(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  date: z.string(),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
    content: z.string(), // base64
  })).default([]),
  spamVerdict: z.string().optional(),
  virusVerdict: z.string().optional(),
});

type InboundEmailPayload = z.infer<typeof InboundEmailSchema>;

/**
 * Register email inbound routes
 */
export async function emailInboundRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/email/inbound
   * Webhook handler for incoming emails from AWS Lambda
   */
  fastify.post<{
    Body: InboundEmailPayload;
  }>('/api/email/inbound', async (request, reply) => {
    // 1. Verify webhook secret
    const secret = request.headers['x-webhook-secret'];
    if (!WEBHOOK_SECRET) {
      fastify.log.error('HOSTED_EMAIL_WEBHOOK_SECRET not configured');
      return reply.code(500).send({ error: 'Webhook not configured' });
    }

    if (secret !== WEBHOOK_SECRET) {
      fastify.log.warn({ providedSecret: secret ? '[redacted]' : 'none' }, 'Invalid webhook secret');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // 2. Parse and validate body
    const parseResult = InboundEmailSchema.safeParse(request.body);
    if (!parseResult.success) {
      fastify.log.error({ errors: parseResult.error.issues }, 'Invalid inbound email payload');
      return reply.code(400).send({
        error: 'Invalid payload',
        details: parseResult.error.issues,
      });
    }

    const email = parseResult.data;

    // 3. Reject spam/virus emails
    if (email.spamVerdict === 'FAIL' || email.virusVerdict === 'FAIL') {
      fastify.log.info(
        { messageId: email.messageId, spamVerdict: email.spamVerdict, virusVerdict: email.virusVerdict },
        'Email rejected: spam or virus verdict'
      );
      return reply.code(200).send({ status: 'ignored', reason: 'spam_or_virus' });
    }

    // 4. Extract alias from recipient
    // e.g., "toby@inbox.getfamilyassistant.com" → "toby"
    const recipientMatch = email.recipient.match(/^([^@]+)@/);
    if (!recipientMatch) {
      fastify.log.warn({ recipient: email.recipient }, 'Could not parse recipient');
      return reply.code(400).send({ error: 'Invalid recipient format' });
    }
    const alias = recipientMatch[1].toLowerCase();

    // 5. Look up user by alias
    const user = getUserByHostedAlias(alias);
    if (!user) {
      fastify.log.info({ alias }, 'No user found for alias, ignoring email');
      return reply.code(200).send({ status: 'ignored', reason: 'unknown_alias' });
    }

    // 6. Detect Gmail forwarding confirmation email — store URL and return early
    // Must run before duplicate check since confirmation emails are never stored in emails table
    fastify.log.info({ from: email.from, subject: email.subject }, 'Inbound email received');
    if (
      email.from.toLowerCase().includes('forwarding-noreply@google.com') &&
      email.subject.includes('Gmail Forwarding Confirmation')
    ) {
      // Try plain text body first; fall back to extracting href from raw HTML
      // (stripping tags first would destroy URLs inside href attributes)
      let confirmationUrl: string | undefined;
      if (email.textBody) {
        confirmationUrl = email.textBody.match(/https?:\/\/[^\s<>"]+/)?.[0];
      }
      if (!confirmationUrl && email.htmlBody) {
        confirmationUrl = email.htmlBody.match(/href="(https?:\/\/[^"]+)"/i)?.[1];
      }
      if (confirmationUrl) {
        setGmailConfirmationUrl(user.user_id, confirmationUrl);
        fastify.log.info({ userId: user.user_id, confirmationUrl }, 'Stored Gmail forwarding confirmation URL');
      } else {
        fastify.log.warn({ userId: user.user_id, subject: email.subject }, 'Gmail forwarding confirmation email received but no URL found in body');
      }
      return reply.code(200).send({ status: 'ignored', reason: 'gmail_forwarding_confirmation', urlStored: !!confirmationUrl });
    }

    // 7. Check for duplicate
    if (emailExistsBySource(user.user_id, 'hosted', email.messageId)) {
      fastify.log.info({ messageId: email.messageId }, 'Duplicate email, skipping');
      return reply.code(200).send({ status: 'duplicate' });
    }

    // 9. Build email body (prefer text, fall back to stripped HTML)
    let bodyText = email.textBody || '';
    if (!bodyText && email.htmlBody) {
      bodyText = email.htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // 7. Process attachments
    const processedAttachments: DownloadedAttachment[] = [];

    let attachmentContent = '';
    let hasExtractionFailure = false;

    if (email.attachments.length > 0) {
      for (const att of email.attachments) {
        const buffer = Buffer.from(att.content, 'base64');
        const text = await extractTextFromAttachment(buffer, att.contentType, att.filename);
        const failed = text.includes('extraction failed') || text.includes('download failed');

        processedAttachments.push({
          filename: att.filename,
          mimeType: att.contentType,
          size: att.size,
          attachmentId: '', // Not from Gmail
          buffer,
          extractedText: text,
          extractionFailed: failed,
          extractionError: failed ? text : undefined,
        });

        if (failed) hasExtractionFailure = true;
      }

      attachmentContent = buildAttachmentContentString(
        processedAttachments.map(a => ({ filename: a.filename, extractedText: a.extractedText }))
      );

      // Append to body
      bodyText += attachmentContent;
    }

    // 8. Store email
    const emailId = createEmail(user.user_id, {
      gmail_message_id: email.messageId, // Reuse field for compatibility
      from_email: email.from,
      from_name: email.fromName,
      subject: email.subject,
      date: new Date(email.date),
      body_text: bodyText,
      snippet: (email.textBody || bodyText).substring(0, 200),
      labels: ['HOSTED_INBOUND'],
      has_attachments: email.attachments.length > 0,
      attachment_content: attachmentContent || undefined,
      attachment_extraction_failed: hasExtractionFailure,
      source_type: 'hosted',
      source_message_id: email.messageId,
    });

    // 9. Store attachment files
    if (processedAttachments.length > 0) {
      storeDownloadedAttachments(user.user_id, emailId, processedAttachments);
    }

    // 10. Mark as processed (ready for analysis)
    markEmailProcessed(user.user_id, emailId);

    fastify.log.info(
      {
        emailId,
        userId: user.user_id,
        alias,
        subject: email.subject,
        attachments: email.attachments.length,
      },
      'Inbound email stored successfully'
    );

    return reply.code(200).send({
      status: 'stored',
      emailId,
      userId: user.user_id,
    });
  });

  /**
   * GET /api/email/inbound/health
   * Health check for the inbound webhook
   */
  fastify.get('/api/email/inbound/health', async (request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      configured: !!WEBHOOK_SECRET,
    });
  });
}
