// src/routes/checkoutRoutes.ts
import type { FastifyInstance } from 'fastify';

/**
 * Stripe Price IDs - Configure these in your .env file
 * Create these prices in your Stripe Dashboard first
 */
const STRIPE_PRICE_IDS = {
  earlyBird: process.env.STRIPE_PRICE_EARLY_BIRD || '',
  pro: process.env.STRIPE_PRICE_PRO || '',
  concierge: process.env.STRIPE_PRICE_CONCIERGE || '',
};

/**
 * Plan configuration
 */
const PLANS = {
  earlyBird: {
    name: 'Early Bird',
    priceId: STRIPE_PRICE_IDS.earlyBird,
    price: 549, // in pence
  },
  pro: {
    name: 'Pro',
    priceId: STRIPE_PRICE_IDS.pro,
    price: 1999,
  },
  concierge: {
    name: 'Concierge',
    priceId: STRIPE_PRICE_IDS.concierge,
    price: 4999,
  },
};

type PlanKey = keyof typeof PLANS;

/**
 * Register checkout routes
 *
 * Note: For a full Stripe integration, you'll need to:
 * 1. Install stripe: pnpm add stripe
 * 2. Create prices in Stripe Dashboard
 * 3. Add STRIPE_SECRET_KEY to .env
 * 4. Uncomment the Stripe code below
 */
export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/checkout
   * Create a Stripe Checkout session and redirect
   *
   * Query params:
   * - plan: 'earlyBird' | 'pro' | 'concierge'
   */
  fastify.get<{
    Querystring: { plan?: string };
  }>('/api/checkout', async (request, reply) => {
    const { plan } = request.query;

    // Validate plan
    if (!plan || !Object.keys(PLANS).includes(plan)) {
      return reply.status(400).send({
        error: 'Invalid plan',
        validPlans: Object.keys(PLANS),
      });
    }

    const selectedPlan = PLANS[plan as PlanKey];

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      // Stripe not configured - redirect to auth for now
      fastify.log.warn('Stripe not configured, redirecting to auth');
      return reply.redirect('/auth/google');
    }

    // TODO: Uncomment when Stripe is installed and configured
    /*
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: selectedPlan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.BASE_URL}/auth/google?checkout=success&plan=${plan}`,
      cancel_url: `${process.env.BASE_URL}/#pricing`,
      subscription_data: {
        trial_period_days: 7,
      },
    });

    return reply.redirect(303, session.url!);
    */

    // Temporary: redirect to Google auth with plan info
    return reply.redirect(`/auth/google?plan=${plan}`);
  });

  /**
   * POST /api/webhook/stripe
   * Handle Stripe webhooks (subscription events, etc.)
   */
  fastify.post('/api/webhook/stripe', async (request, reply) => {
    // TODO: Implement Stripe webhook handling
    // This would handle:
    // - checkout.session.completed
    // - customer.subscription.updated
    // - customer.subscription.deleted
    // - invoice.payment_failed

    fastify.log.info('Stripe webhook received');
    return reply.status(200).send({ received: true });
  });
}
