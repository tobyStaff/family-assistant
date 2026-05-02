// src/lib/onboardingState.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../db/db.js', async () => {
  const { createTestDb } = await import('../tests/createTestDb.js');
  return { default: createTestDb() };
});

import { getNextOnboardingStep, isOnboardingComplete } from './onboardingState.js';
import db from '../db/db.js';

const testDb = db as Database.Database;

const USER_ID = 'user_1';

function seedUser(alias: string | null): void {
  testDb.prepare(
    `INSERT INTO users (user_id, email, hosted_email_alias) VALUES (?, ?, ?)`
  ).run(USER_ID, 'user1@example.com', alias);
}

function seedChild(): void {
  testDb.prepare(
    `INSERT INTO child_profiles (user_id, real_name, is_active) VALUES (?, ?, 1)`
  ).run(USER_ID, 'Alice');
}

function seedEmail(): void {
  testDb.prepare(
    `INSERT INTO emails (user_id, gmail_message_id, from_email, subject, date)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(USER_ID, 'msg_1', 'sender@school.example', 'Newsletter');
}

describe('getNextOnboardingStep', () => {
  beforeEach(() => {
    testDb.exec(`
      DELETE FROM emails;
      DELETE FROM child_profiles;
      DELETE FROM users;
    `);
  });

  it('returns "alias" when user has no alias, no children, no emails', () => {
    seedUser(null);
    expect(getNextOnboardingStep(USER_ID)).toBe('alias');
  });

  it('returns "alias" when user has no alias but has children', () => {
    seedUser(null);
    seedChild();
    expect(getNextOnboardingStep(USER_ID)).toBe('alias');
  });

  it('returns "alias" when user has no alias but has emails', () => {
    seedUser(null);
    seedEmail();
    expect(getNextOnboardingStep(USER_ID)).toBe('alias');
  });

  it('returns "alias" when user has no alias, but has children and emails', () => {
    seedUser(null);
    seedChild();
    seedEmail();
    expect(getNextOnboardingStep(USER_ID)).toBe('alias');
  });

  it('returns "children" when user has alias but no children', () => {
    seedUser('toby');
    expect(getNextOnboardingStep(USER_ID)).toBe('children');
  });

  it('returns "children" when user has alias and emails but no children', () => {
    seedUser('toby');
    seedEmail();
    expect(getNextOnboardingStep(USER_ID)).toBe('children');
  });

  it('returns "forward" when user has alias and children but no emails', () => {
    seedUser('toby');
    seedChild();
    expect(getNextOnboardingStep(USER_ID)).toBe('forward');
  });

  it('returns "done" when user has alias, children, and at least one email', () => {
    seedUser('toby');
    seedChild();
    seedEmail();
    expect(getNextOnboardingStep(USER_ID)).toBe('done');
  });

  it('ignores inactive child profiles when determining "children" step', () => {
    seedUser('toby');
    testDb.prepare(
      `INSERT INTO child_profiles (user_id, real_name, is_active) VALUES (?, ?, 0)`
    ).run(USER_ID, 'Inactive Child');
    expect(getNextOnboardingStep(USER_ID)).toBe('children');
  });
});

describe('isOnboardingComplete', () => {
  beforeEach(() => {
    testDb.exec(`
      DELETE FROM emails;
      DELETE FROM child_profiles;
      DELETE FROM users;
    `);
  });

  it('returns true only when alias, children, and emails are all present', () => {
    seedUser('toby');
    seedChild();
    seedEmail();
    expect(isOnboardingComplete(USER_ID)).toBe(true);
  });

  it('returns false when any prerequisite is missing', () => {
    seedUser('toby');
    seedChild();
    expect(isOnboardingComplete(USER_ID)).toBe(false);
  });
});
