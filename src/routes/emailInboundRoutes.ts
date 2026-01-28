// src/routes/emailInboundRoutes.ts

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserByHostedAlias } from '../db/userDb.js';
import {
  createEmail,
  emailExistsBySource,
  markEmailProcessed,
} from '../db/emailDb.js';
import { storeDownloadedAttachments } from '../utils/attachmentExtractor.js';

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
 * Extract text from attachment buffer based on mime type
 */
async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<{ text: string; failed: boolean }> {
  try {
    // PDF
    if (mimeType === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      const pdfjsLib = pdfjs;
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdf = await loadingTask.promise;

      const textParts: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        textParts.push(pageText);
      }

      const fullText = textParts.join('\n\n').trim();
      return { text: fullText || '[PDF - no text content]', failed: false };
    }

    // DOCX
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.default.extractRawText({ buffer });
      return { text: result.value.trim(), failed: false };
    }

    // Plain text
    if (mimeType.startsWith('text/')) {
      let text = buffer.toString('utf-8').trim();
      if (mimeType === 'text/html') {
        text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      return { text, failed: false };
    }

    return { text: `[${filename} - unsupported format]`, failed: false };
  } catch (error: any) {
    console.error(`Failed to extract text from ${filename}:`, error.message);
    return { text: `[${filename} - extraction failed: ${error.message}]`, failed: true };
  }
}

/**
 * Build attachment content string for AI processing
 */
function buildAttachmentContent(
  attachments: Array<{ filename: string; extractedText: string }>
): string {
  if (attachments.length === 0) return '';

  let result = '\n\n=== IMPORTANT: ATTACHMENT CONTENT BELOW ===\n';
  result += 'This email contains document attachments. Extract all relevant information:\n';
  result += '- Key dates and deadlines → add to calendar_updates\n';
  result += '- Payment requests → add to financials with amounts and deadlines\n';
  result += '- Action items → mention in summary\n';
  result += '- If forms require signature/action → add to attachments_requiring_review\n\n';

  for (const att of attachments) {
    result += `--- START: ${att.filename} ---\n`;
    result += att.extractedText + '\n';
    result += `--- END: ${att.filename} ---\n\n`;
  }

  result += '\n=== END ATTACHMENT CONTENT ===\n';
  return result;
}

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

    // 3. Extract alias from recipient
    // e.g., "toby@inbox.getfamilyassistant.com" → "toby"
    const recipientMatch = email.recipient.match(/^([^@]+)@/);
    if (!recipientMatch) {
      fastify.log.warn({ recipient: email.recipient }, 'Could not parse recipient');
      return reply.code(400).send({ error: 'Invalid recipient format' });
    }
    const alias = recipientMatch[1].toLowerCase();

    // 4. Look up user by alias
    const user = getUserByHostedAlias(alias);
    if (!user) {
      fastify.log.info({ alias }, 'No user found for alias, ignoring email');
      return reply.code(200).send({ status: 'ignored', reason: 'unknown_alias' });
    }

    // 5. Check for duplicate
    if (emailExistsBySource(user.user_id, 'hosted', email.messageId)) {
      fastify.log.info({ messageId: email.messageId }, 'Duplicate email, skipping');
      return reply.code(200).send({ status: 'duplicate' });
    }

    // 6. Build email body (prefer text, fall back to stripped HTML)
    let bodyText = email.textBody || '';
    if (!bodyText && email.htmlBody) {
      bodyText = email.htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // 7. Process attachments
    const processedAttachments: Array<{
      filename: string;
      mimeType: string;
      size: number;
      buffer: Buffer;
      extractedText: string;
      extractionFailed: boolean;
    }> = [];

    let attachmentContent = '';
    let hasExtractionFailure = false;

    if (email.attachments.length > 0) {
      for (const att of email.attachments) {
        const buffer = Buffer.from(att.content, 'base64');
        const { text, failed } = await extractTextFromBuffer(buffer, att.contentType, att.filename);

        processedAttachments.push({
          filename: att.filename,
          mimeType: att.contentType,
          size: att.size,
          buffer,
          extractedText: text,
          extractionFailed: failed,
        });

        if (failed) hasExtractionFailure = true;
      }

      attachmentContent = buildAttachmentContent(
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
      const downloadedAttachments = processedAttachments.map(att => ({
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        attachmentId: '', // Not from Gmail
        buffer: att.buffer,
        extractedText: att.extractedText,
        extractionFailed: att.extractionFailed,
      }));

      storeDownloadedAttachments(user.user_id, emailId, downloadedAttachments);
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
