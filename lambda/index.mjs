/**
 * AWS Lambda function to process inbound emails from SES
 *
 * Flow:
 * 1. SES receives email at @inbox.getfamilyassistant.com
 * 2. SES stores raw email in S3
 * 3. SES invokes this Lambda
 * 4. Lambda fetches email from S3, parses it
 * 5. Lambda calls app webhook with parsed email data
 *
 * Environment variables:
 * - WEBHOOK_URL: The app's webhook endpoint
 * - WEBHOOK_SECRET: Shared secret for authentication
 * - EMAIL_BUCKET: S3 bucket where SES stores emails
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';

const s3 = new S3Client({});

export const handler = async (event) => {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const bucket = process.env.EMAIL_BUCKET;

  // Validate environment
  if (!webhookUrl || !webhookSecret || !bucket) {
    console.error('Missing required environment variables');
    throw new Error('Lambda not configured correctly');
  }

  console.log('Received SES event with', event.Records.length, 'record(s)');

  for (const record of event.Records) {
    const { mail, receipt } = record.ses;
    const messageId = mail.messageId;

    console.log(`Processing email ${messageId}`);
    console.log(`  From: ${mail.source}`);
    console.log(`  To: ${mail.destination.join(', ')}`);
    console.log(`  Subject: ${mail.commonHeaders?.subject || '(no subject)'}`);

    // Skip spam
    if (receipt.spamVerdict.status === 'FAIL') {
      console.log(`Skipping spam email: ${messageId}`);
      continue;
    }

    // Skip virus
    if (receipt.virusVerdict.status === 'FAIL') {
      console.log(`Skipping virus email: ${messageId}`);
      continue;
    }

    try {
      // Fetch raw email from S3
      console.log(`Fetching ${messageId} from S3 bucket ${bucket}`);
      const { Body } = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: messageId,
      }));

      if (!Body) {
        console.error(`No body found for message ${messageId}`);
        continue;
      }

      // Parse email using mailparser
      const bodyBytes = await Body.transformToByteArray();
      const parsed = await simpleParser(Buffer.from(bodyBytes));

      // Extract recipient (the alias@inbox.getfamilyassistant.com address)
      const recipient = mail.destination[0];

      // Build webhook payload
      const payload = {
        messageId: messageId,
        recipient: recipient,
        from: parsed.from?.value[0]?.address || mail.source,
        fromName: parsed.from?.value[0]?.name || undefined,
        subject: parsed.subject || '(no subject)',
        textBody: parsed.text || undefined,
        htmlBody: parsed.html || undefined,
        date: parsed.date?.toISOString() || mail.timestamp,
        attachments: (parsed.attachments || []).map((att) => ({
          filename: att.filename || 'unnamed',
          contentType: att.contentType,
          size: att.size,
          content: att.content.toString('base64'),
        })),
        spamVerdict: receipt.spamVerdict.status,
        virusVerdict: receipt.virusVerdict.status,
      };

      console.log(`Parsed email: ${payload.attachments.length} attachment(s)`);

      // Call webhook
      console.log(`Calling webhook: ${webhookUrl}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Webhook failed for ${messageId}: ${response.status} ${errorText}`);
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`Successfully processed ${messageId}:`, JSON.stringify(result));

    } catch (error) {
      console.error(`Error processing ${messageId}:`, error);
      // Throw to trigger Lambda retry
      throw error;
    }
  }

  return { status: 'ok', processed: event.Records.length };
};
