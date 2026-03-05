// src/utils/onboardingSequence.ts
// Daily cron logic for the 7-day onboarding email sequence.
// Runs once per day after the user generates their first briefing.

import { getUsersInTrial } from '../db/userDb.js';
import { hasOnboardingEmailBeenSent, markOnboardingEmailSent } from '../db/trialDb.js';
import { getChildProfiles } from '../db/childProfilesDb.js';
import { getOrCreateDefaultSettings } from '../db/settingsDb.js';
import {
  renderDay2AutomationNudgeEmail,
  renderDay4MagicFeatureEmail,
  renderDay5PartnerInviteEmail,
  renderDay6PreviewEmail,
  renderDay7PaywallEmail,
} from '../templates/onboardingSequenceEmails.js';
import { sendEmail, buildSesFromAddress } from './emailSender.js';
import { getHostedEmailAlias } from '../db/userDb.js';

/**
 * Calculate the number of full days elapsed since a reference date.
 */
function daysSince(referenceDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - referenceDate.getTime()) / msPerDay);
}

/**
 * Send a single onboarding sequence email and record it in the DB.
 */
async function sendOnboardingEmail(
  userId: string,
  userEmail: string,
  day: number,
  emailType: string,
  html: string,
  log: any
): Promise<void> {
  const settings = getOrCreateDefaultSettings(userId);
  const recipients = settings.summary_email_recipients.length > 0
    ? settings.summary_email_recipients
    : [userEmail];

  const alias = getHostedEmailAlias(userId);
  const fromAddress = buildSesFromAddress(alias);
  const subject = `Day ${day}: ${emailType.replace(/_/g, ' ')}`;

  await sendEmail(html, recipients, fromAddress, subject);
  markOnboardingEmailSent(userId, day, emailType);
  log.info({ userId, day, emailType, recipients }, 'Onboarding sequence email sent');
}

/**
 * Run the daily onboarding sequence check for all trial users.
 * Called by the `onboardingSequence` cron job in dailySummary.ts.
 *
 * Day 1 welcome email is sent at briefing generation time, NOT here.
 * This function handles days 2–7.
 */
export async function runOnboardingSequence(log: any): Promise<void> {
  log.info('Onboarding sequence: starting daily run');

  let processed = 0;
  let sent = 0;
  let errors = 0;

  const users = getUsersInTrial();
  log.info({ userCount: users.length }, 'Onboarding sequence: users in trial');

  for (const user of users) {
    try {
      const trialStarted = new Date(user.trial_started_at);
      const day = daysSince(trialStarted);

      // Day 2: automation nudge
      if (day >= 2 && !hasOnboardingEmailBeenSent(user.id, 2, 'automation_nudge')) {
        const userName = user.name?.split(' ')[0] || '';
        const html = renderDay2AutomationNudgeEmail({ userName });
        await sendOnboardingEmail(user.id, user.email, 2, 'automation_nudge', html, log);
        sent++;
      }

      // Day 4: magic feature highlight
      if (day >= 4 && !hasOnboardingEmailBeenSent(user.id, 4, 'magic_feature')) {
        const userName = user.name?.split(' ')[0] || '';
        const html = renderDay4MagicFeatureEmail({ userName });
        await sendOnboardingEmail(user.id, user.email, 4, 'magic_feature', html, log);
        sent++;
      }

      // Day 5: partner invite
      if (day >= 5 && !hasOnboardingEmailBeenSent(user.id, 5, 'partner_invite')) {
        const userName = user.name?.split(' ')[0] || '';
        const html = renderDay5PartnerInviteEmail({ userName });
        await sendOnboardingEmail(user.id, user.email, 5, 'partner_invite', html, log);
        sent++;
      }

      // Day 6: items tracked preview
      if (day >= 6 && !hasOnboardingEmailBeenSent(user.id, 6, 'preview')) {
        const userName = user.name?.split(' ')[0] || '';
        // Count child profiles as a rough proxy for items tracked
        const profiles = getChildProfiles(user.id);
        const html = renderDay6PreviewEmail({ userName, itemsTracked: profiles.length * 5 });
        await sendOnboardingEmail(user.id, user.email, 6, 'preview', html, log);
        sent++;
      }

      // Day 7: paywall / upgrade prompt
      if (day >= 7 && !hasOnboardingEmailBeenSent(user.id, 7, 'paywall')) {
        const userName = user.name?.split(' ')[0] || '';
        const html = renderDay7PaywallEmail({ userName });
        await sendOnboardingEmail(user.id, user.email, 7, 'paywall', html, log);
        sent++;
      }

      processed++;
    } catch (err) {
      errors++;
      log.error({ err, userId: user.id }, 'Onboarding sequence: error processing user');
    }
  }

  log.info({ processed, sent, errors }, 'Onboarding sequence: daily run complete');
}
