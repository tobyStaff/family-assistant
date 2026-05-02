// src/lib/onboardingState.ts
//
// Single source of truth for onboarding routing. Decides which step a user
// should be on based on data, not a stored step counter.
//
// In dev, the request handler can pass a `skip` set (sourced from a cookie)
// to temporarily treat steps as already-passed without mutating the database.

import db from '../db/db.js';

export type OnboardingStep = 'alias' | 'children' | 'forward' | 'done';
export type OnboardingFlowStep = Exclude<OnboardingStep, 'done'>;

export const ONBOARDING_FLOW_ORDER: readonly OnboardingFlowStep[] = ['alias', 'children', 'forward'];

const hasAliasStmt = db.prepare(
  `SELECT hosted_email_alias FROM users WHERE user_id = ?`
);
const childCountStmt = db.prepare(
  `SELECT COUNT(*) AS count FROM child_profiles WHERE user_id = ? AND is_active = 1`
);
const emailCountStmt = db.prepare(
  `SELECT COUNT(*) AS count FROM emails WHERE user_id = ?`
);

function isStepComplete(userId: string, step: OnboardingFlowStep): boolean {
  switch (step) {
    case 'alias': {
      const row = hasAliasStmt.get(userId) as { hosted_email_alias: string | null } | undefined;
      return !!row?.hosted_email_alias;
    }
    case 'children': {
      const row = childCountStmt.get(userId) as { count: number };
      return row.count > 0;
    }
    case 'forward': {
      const row = emailCountStmt.get(userId) as { count: number };
      return row.count > 0;
    }
  }
}

export function getNextOnboardingStep(
  userId: string,
  skip: ReadonlySet<OnboardingFlowStep> = new Set()
): OnboardingStep {
  for (const step of ONBOARDING_FLOW_ORDER) {
    if (skip.has(step)) continue;
    if (!isStepComplete(userId, step)) return step;
  }
  return 'done';
}

export function isOnboardingComplete(
  userId: string,
  skip: ReadonlySet<OnboardingFlowStep> = new Set()
): boolean {
  return getNextOnboardingStep(userId, skip) === 'done';
}
