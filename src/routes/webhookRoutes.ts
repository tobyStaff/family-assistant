// src/routes/webhookRoutes.ts
//
// Handles inbound SNS notifications from AWS SES for bounce and complaint events.
// AWS SNS posts JSON to these endpoints; no session auth required.

import type { FastifyInstance } from 'fastify';
import { suppressUserByEmail } from '../db/userDb.js';

/**
 * Parse the raw SNS envelope body.
 * SNS sends Content-Type: text/plain with a JSON body.
 */
function parseSnsBody(body: unknown): Record<string, any> | null {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, any>;
  }
  return null;
}

/**
 * Confirm an SNS subscription by GETting the SubscribeURL.
 * SNS sends this once when you first create the HTTPS subscription.
 */
async function confirmSubscription(subscribeUrl: string, log: any): Promise<void> {
  try {
    const res = await fetch(subscribeUrl);
    log.info({ status: res.status }, 'SNS subscription confirmed');
  } catch (err) {
    log.error({ err }, 'Failed to confirm SNS subscription');
  }
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/ses-bounce
   * SNS topic: SES bounce notifications
   */
  fastify.post('/webhooks/ses-bounce', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const envelope = parseSnsBody(request.body);
    if (!envelope) {
      return reply.status(400).send({ error: 'Invalid SNS payload' });
    }

    // Validate topic ARN if configured
    const expectedArn = process.env.SNS_BOUNCE_TOPIC_ARN;
    if (expectedArn && envelope.TopicArn !== expectedArn) {
      request.log.warn({ topicArn: envelope.TopicArn }, 'Unexpected SNS topic ARN for bounce');
      return reply.status(403).send({ error: 'Unexpected topic' });
    }

    // Confirm subscription handshake
    if (envelope.Type === 'SubscriptionConfirmation') {
      await confirmSubscription(envelope.SubscribeURL, request.log);
      return reply.status(200).send({ ok: true });
    }

    if (envelope.Type !== 'Notification') {
      return reply.status(200).send({ ok: true });
    }

    let notification: any;
    try {
      notification = JSON.parse(envelope.Message);
    } catch {
      request.log.error('Failed to parse SES bounce notification Message');
      return reply.status(400).send({ error: 'Invalid notification payload' });
    }

    if (notification.notificationType !== 'Bounce') {
      return reply.status(200).send({ ok: true });
    }

    const bouncedRecipients: string[] = (notification.bounce?.bouncedRecipients ?? [])
      .map((r: any) => r.emailAddress)
      .filter(Boolean);

    for (const email of bouncedRecipients) {
      const suppressed = suppressUserByEmail(email);
      request.log.info(
        { email, suppressed, bounceType: notification.bounce?.bounceType },
        'SES bounce: email suppressed'
      );
    }

    return reply.status(200).send({ ok: true });
  });

  /**
   * POST /webhooks/ses-complaint
   * SNS topic: SES complaint notifications
   */
  fastify.post('/webhooks/ses-complaint', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const envelope = parseSnsBody(request.body);
    if (!envelope) {
      return reply.status(400).send({ error: 'Invalid SNS payload' });
    }

    // Validate topic ARN if configured
    const expectedArn = process.env.SNS_COMPLAINT_TOPIC_ARN;
    if (expectedArn && envelope.TopicArn !== expectedArn) {
      request.log.warn({ topicArn: envelope.TopicArn }, 'Unexpected SNS topic ARN for complaint');
      return reply.status(403).send({ error: 'Unexpected topic' });
    }

    // Confirm subscription handshake
    if (envelope.Type === 'SubscriptionConfirmation') {
      await confirmSubscription(envelope.SubscribeURL, request.log);
      return reply.status(200).send({ ok: true });
    }

    if (envelope.Type !== 'Notification') {
      return reply.status(200).send({ ok: true });
    }

    let notification: any;
    try {
      notification = JSON.parse(envelope.Message);
    } catch {
      request.log.error('Failed to parse SES complaint notification Message');
      return reply.status(400).send({ error: 'Invalid notification payload' });
    }

    if (notification.notificationType !== 'Complaint') {
      return reply.status(200).send({ ok: true });
    }

    const complainedRecipients: string[] = (notification.complaint?.complainedRecipients ?? [])
      .map((r: any) => r.emailAddress)
      .filter(Boolean);

    for (const email of complainedRecipients) {
      const suppressed = suppressUserByEmail(email);
      request.log.info(
        { email, suppressed },
        'SES complaint: email suppressed'
      );
    }

    return reply.status(200).send({ ok: true });
  });
}
