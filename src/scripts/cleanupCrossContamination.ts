#!/usr/bin/env node
// src/scripts/cleanupCrossContamination.ts
/**
 * Cross-Contamination Cleanup Script
 *
 * Removes emails (and their associated analyses, todos, events) that were
 * accidentally stored under the wrong user due to the impersonation + Gmail
 * fetch bug where admin's OAuth tokens fetched emails stored under
 * the impersonated user's account.
 *
 * Usage:
 *   node dist/scripts/cleanupCrossContamination.js <admin_email> <contaminated_user_email>
 *
 * Example:
 *   node dist/scripts/cleanupCrossContamination.js tobystafford.assistant@gmail.com chayter.assistant@gmail.com
 *
 * What it does:
 *   1. Finds the admin user and contaminated user by email
 *   2. Finds emails in the contaminated user's account that were sent TO the admin's email
 *      (these are the admin's emails mistakenly stored under the other user)
 *   3. Deletes associated email_analyses, todos, events, attachments, and processed_emails
 *   4. Deletes the contaminated emails themselves
 *
 * DRY RUN: By default runs in dry-run mode. Pass --execute to actually delete.
 */

import Database from 'better-sqlite3';
import { join } from 'path';

const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'app.db');

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--execute');
  const dryRun = !process.argv.includes('--execute');

  if (args.length < 2) {
    console.error('Usage: node dist/scripts/cleanupCrossContamination.js <admin_email> <contaminated_user_email> [--execute]');
    console.error('');
    console.error('Without --execute, runs in dry-run mode (shows what would be deleted).');
    process.exit(1);
  }

  const [adminEmail, contaminatedEmail] = args;

  console.log(`Database: ${DB_PATH}`);
  console.log(`Admin email: ${adminEmail}`);
  console.log(`Contaminated user email: ${contaminatedEmail}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will delete data)'}`);
  console.log('---');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Find both users
  const adminUser = db.prepare('SELECT user_id, email FROM users WHERE email = ?').get(adminEmail) as { user_id: string; email: string } | undefined;
  const contaminatedUser = db.prepare('SELECT user_id, email FROM users WHERE email = ?').get(contaminatedEmail) as { user_id: string; email: string } | undefined;

  if (!adminUser) {
    console.error(`Admin user not found: ${adminEmail}`);
    process.exit(1);
  }
  if (!contaminatedUser) {
    console.error(`Contaminated user not found: ${contaminatedEmail}`);
    process.exit(1);
  }

  console.log(`Admin user_id: ${adminUser.user_id}`);
  console.log(`Contaminated user_id: ${contaminatedUser.user_id}`);
  console.log('---');

  // Find emails in the contaminated user's account that likely belong to the admin.
  // These are emails where the gmail_message_id exists in BOTH users' accounts,
  // OR emails addressed to the admin's email that shouldn't be in the contaminated user's account.
  //
  // Strategy: Find emails stored under contaminatedUser that have the same gmail_message_id
  // as emails stored under adminUser (duplicate fetches from same Gmail account).
  const duplicateEmails = db.prepare(`
    SELECT c.id, c.gmail_message_id, c.from_email, c.subject, c.date
    FROM emails c
    INNER JOIN emails a ON c.gmail_message_id = a.gmail_message_id
    WHERE c.user_id = ? AND a.user_id = ?
  `).all(contaminatedUser.user_id, adminUser.user_id) as Array<{
    id: number;
    gmail_message_id: string;
    from_email: string;
    subject: string;
    date: string;
  }>;

  console.log(`Found ${duplicateEmails.length} emails in ${contaminatedEmail}'s account that also exist in ${adminEmail}'s account:`);
  for (const email of duplicateEmails) {
    console.log(`  [${email.id}] ${email.date} | From: ${email.from_email} | Subject: ${email.subject}`);
  }
  console.log('---');

  if (duplicateEmails.length === 0) {
    // Also check for emails that don't have duplicates but were clearly fetched from admin's Gmail
    // (e.g., emails TO the admin that the contaminated user wouldn't normally receive)
    const suspiciousEmails = db.prepare(`
      SELECT id, gmail_message_id, from_email, subject, date
      FROM emails
      WHERE user_id = ?
      ORDER BY date DESC
    `).all(contaminatedUser.user_id) as Array<{
      id: number;
      gmail_message_id: string;
      from_email: string;
      subject: string;
      date: string;
    }>;

    console.log(`Total emails in ${contaminatedEmail}'s account: ${suspiciousEmails.length}`);
    console.log('No duplicate gmail_message_ids found. You may need to manually identify contaminated emails.');
    console.log('Listing all emails for manual review:');
    for (const email of suspiciousEmails.slice(0, 50)) {
      console.log(`  [${email.id}] ${email.date} | From: ${email.from_email} | Subject: ${email.subject}`);
    }
    db.close();
    return;
  }

  const emailIds = duplicateEmails.map(e => e.id);
  const placeholders = emailIds.map(() => '?').join(',');

  if (dryRun) {
    // Show what would be deleted
    const analysesCount = db.prepare(
      `SELECT COUNT(*) as count FROM email_analyses WHERE email_id IN (${placeholders})`
    ).get(...emailIds) as { count: number };

    const todosCount = db.prepare(
      `SELECT COUNT(*) as count FROM todos WHERE source_email_id IN (${placeholders}) AND user_id = ?`
    ).get(...emailIds, contaminatedUser.user_id) as { count: number };

    const eventsCount = db.prepare(
      `SELECT COUNT(*) as count FROM events WHERE source_email_id IN (${placeholders}) AND user_id = ?`
    ).get(...emailIds, contaminatedUser.user_id) as { count: number };

    console.log('DRY RUN - Would delete:');
    console.log(`  ${duplicateEmails.length} emails`);
    console.log(`  ${analysesCount.count} email analyses`);
    console.log(`  ${todosCount.count} todos`);
    console.log(`  ${eventsCount.count} events`);
    console.log('');
    console.log('Run with --execute to perform the deletion.');
  } else {
    // Execute deletion in a transaction
    const deleteAll = db.transaction(() => {
      // Delete analyses linked to these emails
      const analysesResult = db.prepare(
        `DELETE FROM email_analyses WHERE email_id IN (${placeholders})`
      ).run(...emailIds);
      console.log(`Deleted ${analysesResult.changes} email analyses`);

      // Delete todos sourced from these emails (for the contaminated user only)
      const todosResult = db.prepare(
        `DELETE FROM todos WHERE source_email_id IN (${placeholders}) AND user_id = ?`
      ).run(...emailIds, contaminatedUser.user_id);
      console.log(`Deleted ${todosResult.changes} todos`);

      // Delete events sourced from these emails (for the contaminated user only)
      const eventsResult = db.prepare(
        `DELETE FROM events WHERE source_email_id IN (${placeholders}) AND user_id = ?`
      ).run(...emailIds, contaminatedUser.user_id);
      console.log(`Deleted ${eventsResult.changes} events`);

      // Delete attachments linked to these emails
      try {
        const attachmentsResult = db.prepare(
          `DELETE FROM email_attachments WHERE email_id IN (${placeholders})`
        ).run(...emailIds);
        console.log(`Deleted ${attachmentsResult.changes} attachments`);
      } catch {
        // Table may not exist
      }

      // Delete processed_emails entries
      const gmailIds = duplicateEmails.map(e => e.gmail_message_id);
      const gmailPlaceholders = gmailIds.map(() => '?').join(',');
      const processedResult = db.prepare(
        `DELETE FROM processed_emails WHERE email_id IN (${gmailPlaceholders}) AND user_id = ?`
      ).run(...gmailIds, contaminatedUser.user_id);
      console.log(`Deleted ${processedResult.changes} processed_emails entries`);

      // Delete the emails themselves
      const emailsResult = db.prepare(
        `DELETE FROM emails WHERE id IN (${placeholders})`
      ).run(...emailIds);
      console.log(`Deleted ${emailsResult.changes} emails`);
    });

    deleteAll();
    console.log('---');
    console.log('Cleanup completed successfully.');
  }

  db.close();
}

main();
