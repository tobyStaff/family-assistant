// src/routes/landingRoutes.ts
import type { FastifyInstance } from 'fastify';
import { generateLandingPage } from '../templates/landingPage.js';
import db from '../db/db.js';

/**
 * Get total emails processed across all users
 */
function getTotalEmailsProcessed(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM processed_emails').get() as { count: number };
  return result?.count || 0;
}

/**
 * Stripe checkout URLs (configure with your Stripe price IDs)
 * These should be Stripe Payment Links or Checkout Session URLs
 */
const STRIPE_URLS = {
  earlyBird: process.env.STRIPE_EARLY_BIRD_URL || '#pricing',
  pro: process.env.STRIPE_PRO_URL || '#pricing',
  concierge: process.env.STRIPE_CONCIERGE_URL || '#pricing',
};

/**
 * Register landing page routes
 */
export async function landingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /
   * Serve the landing page
   */
  fastify.get('/', async (_request, reply) => {
    const totalEmailsProcessed = getTotalEmailsProcessed();

    const html = generateLandingPage({
      totalEmailsProcessed,
      stripeEarlyBirdUrl: STRIPE_URLS.earlyBird,
      stripeProUrl: STRIPE_URLS.pro,
      stripeConciergeUrl: STRIPE_URLS.concierge,
    });

    return reply.type('text/html').send(html);
  });

  /**
   * GET /api/stats
   * Return live stats for the landing page (optional AJAX endpoint)
   */
  fastify.get('/api/stats', async () => {
    return {
      totalEmailsProcessed: getTotalEmailsProcessed(),
    };
  });
}
