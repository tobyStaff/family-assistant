// src/lib/onboardingState.ts
//
// Single source of truth for onboarding routing. Decides which step a user
// should be on based on data, not a stored step counter.

import db from '../db/db.js';

export type OnboardingStep = 'alias' | 'children' | 'forward' | 'done';

const hasAliasStmt = db.prepare(
  `SELECT hosted_email_alias FROM users WHERE user_id = ?`
);
const childCountStmt = db.prepare(
  `SELECT COUNT(*) AS count FROM child_profiles WHERE user_id = ? AND is_active = 1`
);
const emailCountStmt = db.prepare(
  `SELECT COUNT(*) AS count FROM emails WHERE user_id = ?`
);

export function getNextOnboardingStep(userId: string): OnboardingStep {
  const aliasRow = hasAliasStmt.get(userId) as { hosted_email_alias: string | null } | undefined;
  if (!aliasRow?.hosted_email_alias) return 'alias';

  const childRow = childCountStmt.get(userId) as { count: number };
  if (childRow.count === 0) return 'children';

  const emailRow = emailCountStmt.get(userId) as { count: number };
  if (emailRow.count === 0) return 'forward';

  return 'done';
}

export function isOnboardingComplete(userId: string): boolean {
  return getNextOnboardingStep(userId) === 'done';
}
