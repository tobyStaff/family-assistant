// src/services/stripeService.ts

import Stripe from 'stripe';
import type { SubscriptionTier, SubscriptionStatus } from '../types/subscription.js';
import {
  getSubscription,
  upsertSubscription,
  updateSubscriptionStatus,
  updateStripeCustomerId,
  getSubscriptionByStripeCustomerId,
  getSubscriptionByStripeSubscriptionId,
  setCancelAtPeriodEnd,
  updateSubscriptionPeriod,
} from '../db/subscriptionDb.js';
import { getUser } from '../db/userDb.js';
import { getTierByPriceId, getStripePriceId } from '../config/tiers.js';

/**
 * Initialize Stripe client
 * Returns null if Stripe is not configured
 */
function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn('[stripe] STRIPE_SECRET_KEY not configured');
    return null;
  }
  return new Stripe(secretKey);
}

/**
 * Get or create a Stripe customer for a user
 *
 * @param userId - User ID
 * @returns Stripe customer ID or null if Stripe not configured
 */
export async function getOrCreateCustomer(userId: string): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;

  // Check if user already has a Stripe customer ID
  const subscription = getSubscription(userId);
  if (subscription?.stripeCustomerId) {
    return subscription.stripeCustomerId;
  }

  // Get user details for customer creation
  const user = getUser(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: {
      userId,
    },
  });

  // Store customer ID
  updateStripeCustomerId(userId, customer.id);

  console.log(`[stripe] Created customer ${customer.id} for user ${userId}`);
  return customer.id;
}

/**
 * Create a Stripe Checkout session for subscription upgrade
 *
 * @param userId - User ID
 * @param tier - Target subscription tier
 * @param successUrl - URL to redirect on success
 * @param cancelUrl - URL to redirect on cancel
 * @returns Checkout session URL or null if Stripe not configured
 */
export async function createCheckoutSession(
  userId: string,
  tier: SubscriptionTier,
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;

  // Get or create customer
  const customerId = await getOrCreateCustomer(userId);
  if (!customerId) return null;

  // Get price ID for tier
  const priceId = getStripePriceId(tier);
  if (!priceId) {
    throw new Error(`No Stripe price configured for tier: ${tier}`);
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: 7,
      metadata: {
        userId,
        tier,
      },
    },
    metadata: {
      userId,
      tier,
    },
  });

  console.log(`[stripe] Created checkout session ${session.id} for user ${userId}, tier ${tier}`);
  return session.url;
}

/**
 * Create a Stripe Billing Portal session for subscription management
 *
 * @param userId - User ID
 * @param returnUrl - URL to return to after portal
 * @returns Portal URL or null if Stripe not configured
 */
export async function createBillingPortalSession(
  userId: string,
  returnUrl: string
): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const subscription = getSubscription(userId);
  if (!subscription?.stripeCustomerId) {
    throw new Error(`No Stripe customer found for user: ${userId}`);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: returnUrl,
  });

  console.log(`[stripe] Created portal session for user ${userId}`);
  return session.url;
}

/**
 * Handle Stripe webhook events
 *
 * @param event - Stripe webhook event
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  console.log(`[stripe] Handling webhook event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;

    default:
      console.log(`[stripe] Unhandled event type: ${event.type}`);
  }
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  const tier = session.metadata?.tier as SubscriptionTier | undefined;

  if (!userId || !tier) {
    console.error('[stripe] Missing userId or tier in checkout session metadata');
    return;
  }

  console.log(`[stripe] Checkout completed for user ${userId}, tier ${tier}`);

  // Subscription will be created/updated via the subscription webhook
  // Just log for now
}

/**
 * Handle subscription created/updated event
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  // Get user ID from subscription metadata or customer
  let userId = subscription.metadata?.userId;

  if (!userId) {
    // Try to find by Stripe subscription ID
    const existing = getSubscriptionByStripeSubscriptionId(subscription.id);
    if (existing) {
      userId = existing.userId;
    } else {
      // Try to find by customer ID
      const byCustomer = getSubscriptionByStripeCustomerId(subscription.customer as string);
      if (byCustomer) {
        userId = byCustomer.userId;
      }
    }
  }

  if (!userId) {
    console.error(`[stripe] Could not find user for subscription ${subscription.id}`);
    return;
  }

  // Determine tier from price
  const priceId = subscription.items.data[0]?.price?.id;
  let tier: SubscriptionTier = 'FREE';

  if (priceId) {
    const detectedTier = getTierByPriceId(priceId);
    if (detectedTier) {
      tier = detectedTier;
    }
  }

  // Map Stripe status to our status
  const status = mapStripeStatus(subscription.status);

  // Update subscription in database
  // Access period dates safely - they may be in different locations depending on Stripe SDK version
  const periodStart = (subscription as any).current_period_start;
  const periodEnd = (subscription as any).current_period_end;

  upsertSubscription({
    userId,
    tier,
    status,
    stripeCustomerId: subscription.customer as string,
    stripeSubscriptionId: subscription.id,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  });

  console.log(`[stripe] Updated subscription for user ${userId}: tier=${tier}, status=${status}`);
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  // Find subscription by Stripe subscription ID
  const existing = getSubscriptionByStripeSubscriptionId(subscription.id);
  if (!existing) {
    console.error(`[stripe] Could not find subscription ${subscription.id} to delete`);
    return;
  }

  // Downgrade to FREE tier and mark as canceled
  upsertSubscription({
    userId: existing.userId,
    tier: 'FREE',
    status: 'canceled',
    stripeCustomerId: existing.stripeCustomerId,
    stripeSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
  });

  console.log(`[stripe] Subscription deleted for user ${existing.userId}, downgraded to FREE`);
}

/**
 * Handle payment failed event
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;

  const subscription = getSubscriptionByStripeCustomerId(customerId);
  if (!subscription) {
    console.error(`[stripe] Could not find subscription for customer ${customerId}`);
    return;
  }

  // Mark as past_due
  updateSubscriptionStatus(subscription.userId, 'past_due');

  console.log(`[stripe] Payment failed for user ${subscription.userId}`);
}

/**
 * Handle payment succeeded event
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;
  const subscriptionId = (invoice as any).subscription as string;

  const subscription = getSubscriptionByStripeCustomerId(customerId);
  if (!subscription) {
    console.error(`[stripe] Could not find subscription for customer ${customerId}`);
    return;
  }

  // Update status to active and update period if needed
  if (subscription.status === 'past_due') {
    updateSubscriptionStatus(subscription.userId, 'active');
  }

  // Update period dates from invoice
  if (invoice.lines?.data?.[0]) {
    const line = invoice.lines.data[0];
    if (line.period?.start && line.period?.end) {
      updateSubscriptionPeriod(
        subscription.userId,
        new Date(line.period.start * 1000),
        new Date(line.period.end * 1000)
      );
    }
  }

  console.log(`[stripe] Payment succeeded for user ${subscription.userId}`);
}

/**
 * Map Stripe subscription status to our status
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
      return 'unpaid';
    case 'incomplete':
      return 'incomplete';
    case 'incomplete_expired':
      return 'incomplete_expired';
    case 'paused':
      return 'paused';
    default:
      return 'active';
  }
}

/**
 * Verify and construct Stripe webhook event
 *
 * @param payload - Raw request body
 * @param signature - Stripe-Signature header
 * @returns Verified Stripe event or null
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event | null {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET not configured');
    return null;
  }

  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err: any) {
    console.error(`[stripe] Webhook signature verification failed: ${err.message}`);
    return null;
  }
}

/**
 * Check if Stripe is properly configured
 *
 * @returns true if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Cancel subscription at period end
 *
 * @param userId - User ID
 * @returns true if successful
 */
export async function cancelSubscriptionAtPeriodEnd(userId: string): Promise<boolean> {
  const stripe = getStripeClient();
  if (!stripe) return false;

  const subscription = getSubscription(userId);
  if (!subscription?.stripeSubscriptionId) {
    throw new Error(`No active subscription found for user: ${userId}`);
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  setCancelAtPeriodEnd(userId, true);

  console.log(`[stripe] Subscription marked for cancellation for user ${userId}`);
  return true;
}

/**
 * Resume subscription (undo cancel at period end)
 *
 * @param userId - User ID
 * @returns true if successful
 */
export async function resumeSubscription(userId: string): Promise<boolean> {
  const stripe = getStripeClient();
  if (!stripe) return false;

  const subscription = getSubscription(userId);
  if (!subscription?.stripeSubscriptionId) {
    throw new Error(`No subscription found for user: ${userId}`);
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  setCancelAtPeriodEnd(userId, false);

  console.log(`[stripe] Subscription resumed for user ${userId}`);
  return true;
}
