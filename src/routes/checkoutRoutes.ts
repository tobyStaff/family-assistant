// src/routes/checkoutRoutes.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SubscriptionTier } from '../types/subscription.js';
import { requireAuth } from '../middleware/session.js';
import { getUserId } from '../lib/userContext.js';
import { getSubscription, ensureSubscription } from '../db/subscriptionDb.js';
import { TIER_CONFIGS, TIER_HIERARCHY } from '../config/tiers.js';
import {
  createCheckoutSession,
  createBillingPortalSession,
  handleWebhookEvent,
  constructWebhookEvent,
  isStripeConfigured,
} from '../services/stripeService.js';

/**
 * Valid tier query parameters for checkout
 */
const VALID_TIERS: SubscriptionTier[] = ['ORGANIZED', 'PROFESSIONAL', 'CONCIERGE'];

/**
 * Register checkout routes
 */
export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/checkout/create-session
   * Create a Stripe Checkout session for subscription upgrade
   */
  fastify.post<{
    Body: { tier: string };
  }>('/api/checkout/create-session', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const { tier } = request.body;

    // Validate tier
    if (!tier || !VALID_TIERS.includes(tier as SubscriptionTier)) {
      return reply.status(400).send({
        error: 'Invalid tier',
        message: `Valid tiers: ${VALID_TIERS.join(', ')}`,
      });
    }

    const targetTier = tier as SubscriptionTier;

    // Check current subscription
    const subscription = getSubscription(userId) || ensureSubscription(userId);

    // Check if already at this tier or higher
    const currentLevel = TIER_HIERARCHY.indexOf(subscription.tier);
    const targetLevel = TIER_HIERARCHY.indexOf(targetTier);

    if (currentLevel >= targetLevel) {
      return reply.status(400).send({
        error: 'Already subscribed',
        message: `You are already on ${subscription.tier} tier`,
      });
    }

    // Check if Stripe is configured
    if (!isStripeConfigured()) {
      fastify.log.warn('Stripe not configured, returning redirect to auth');
      return reply.status(503).send({
        error: 'Payment system unavailable',
        message: 'Stripe is not configured. Please contact support.',
      });
    }

    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const successUrl = `${baseUrl}/settings?checkout=success&tier=${targetTier}`;
      const cancelUrl = `${baseUrl}/settings?checkout=canceled`;

      const checkoutUrl = await createCheckoutSession(
        userId,
        targetTier,
        successUrl,
        cancelUrl
      );

      if (!checkoutUrl) {
        return reply.status(500).send({
          error: 'Checkout failed',
          message: 'Failed to create checkout session',
        });
      }

      return reply.send({ url: checkoutUrl });
    } catch (error: any) {
      fastify.log.error(error, 'Failed to create checkout session');
      return reply.status(500).send({
        error: 'Checkout failed',
        message: error.message || 'Failed to create checkout session',
      });
    }
  });

  /**
   * GET /api/checkout/billing-portal
   * Redirect to Stripe Billing Portal for subscription management
   */
  fastify.get('/api/checkout/billing-portal', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    const subscription = getSubscription(userId);
    if (!subscription?.stripeCustomerId) {
      return reply.status(400).send({
        error: 'No subscription',
        message: 'You do not have an active subscription to manage',
      });
    }

    if (!isStripeConfigured()) {
      return reply.status(503).send({
        error: 'Payment system unavailable',
        message: 'Stripe is not configured. Please contact support.',
      });
    }

    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const returnUrl = `${baseUrl}/settings`;

      const portalUrl = await createBillingPortalSession(userId, returnUrl);

      if (!portalUrl) {
        return reply.status(500).send({
          error: 'Portal failed',
          message: 'Failed to create billing portal session',
        });
      }

      return reply.status(303).redirect(portalUrl);
    } catch (error: any) {
      fastify.log.error(error, 'Failed to create billing portal session');
      return reply.status(500).send({
        error: 'Portal failed',
        message: error.message || 'Failed to create billing portal session',
      });
    }
  });

  /**
   * GET /api/subscription
   * Get current user's subscription status
   */
  fastify.get('/api/subscription', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    const subscription = getSubscription(userId) || ensureSubscription(userId);
    const tierConfig = TIER_CONFIGS[subscription.tier];

    return reply.send({
      tier: subscription.tier,
      tierDisplayName: tierConfig.displayName,
      status: subscription.status,
      priceFormatted: tierConfig.priceFormatted,
      features: tierConfig.features,
      limits: tierConfig.limits,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEnd: subscription.trialEnd?.toISOString() || null,
      hasStripeSubscription: Boolean(subscription.stripeSubscriptionId),
    });
  });

  /**
   * GET /api/checkout
   * Legacy endpoint - redirect to checkout session creation
   * Query params: plan (earlyBird/pro/concierge mapped to new tiers)
   */
  fastify.get<{
    Querystring: { plan?: string };
  }>('/api/checkout', async (request, reply) => {
    const { plan } = request.query;

    // Map legacy plan names to new tier names
    const planToTier: Record<string, SubscriptionTier> = {
      earlyBird: 'ORGANIZED',
      organized: 'ORGANIZED',
      pro: 'PROFESSIONAL',
      professional: 'PROFESSIONAL',
      concierge: 'CONCIERGE',
    };

    const tier = plan ? planToTier[plan.toLowerCase()] : undefined;

    if (!tier) {
      return reply.status(400).send({
        error: 'Invalid plan',
        validPlans: Object.keys(planToTier),
      });
    }

    // If not authenticated, redirect to auth with plan info
    const userId = (request as any).userId;
    if (!userId) {
      return reply.redirect(`/auth/google?plan=${tier.toLowerCase()}`);
    }

    // Check if Stripe is configured
    if (!isStripeConfigured()) {
      fastify.log.warn('Stripe not configured, redirecting to auth');
      return reply.redirect('/auth/google');
    }

    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const successUrl = `${baseUrl}/settings?checkout=success&tier=${tier}`;
      const cancelUrl = `${baseUrl}/#pricing`;

      const checkoutUrl = await createCheckoutSession(userId, tier, successUrl, cancelUrl);

      if (checkoutUrl) {
        return reply.status(303).redirect(checkoutUrl);
      }

      // Fallback to auth
      return reply.redirect(`/auth/google?plan=${tier.toLowerCase()}`);
    } catch (error) {
      fastify.log.error(error, 'Failed to create checkout session');
      return reply.redirect(`/auth/google?plan=${tier.toLowerCase()}`);
    }
  });

  /**
   * POST /api/webhook/stripe
   * Handle Stripe webhooks for subscription lifecycle events
   */
  fastify.post('/api/webhook/stripe', {
    config: {
      rawBody: true,
    },
  }, async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string;

    if (!signature) {
      fastify.log.warn('Missing Stripe signature');
      return reply.status(400).send({ error: 'Missing signature' });
    }

    // Get raw body for signature verification
    const rawBody = (request as any).rawBody || request.body;

    if (!rawBody) {
      fastify.log.warn('Missing request body');
      return reply.status(400).send({ error: 'Missing body' });
    }

    try {
      const event = constructWebhookEvent(
        typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
        signature
      );

      if (!event) {
        return reply.status(400).send({ error: 'Invalid signature or event' });
      }

      await handleWebhookEvent(event);

      return reply.status(200).send({ received: true });
    } catch (error: any) {
      fastify.log.error(error, 'Webhook processing failed');
      return reply.status(400).send({ error: error.message });
    }
  });

  /**
   * GET /api/pricing
   * Get available pricing tiers
   */
  fastify.get('/api/pricing', async (_request, reply) => {
    const tiers = VALID_TIERS.map(tier => {
      const config = TIER_CONFIGS[tier];
      return {
        tier,
        name: config.displayName,
        price: config.price,
        priceFormatted: config.priceFormatted,
        features: config.features,
        limits: config.limits,
      };
    });

    return reply.send({ tiers });
  });
}
