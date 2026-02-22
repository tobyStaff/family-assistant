/**
 * scripts/clearSesEmails.ts
 *
 * Deletes all emails from the SES S3 bucket that were sent to a given alias.
 * Matching is done by searching the raw email bytes for the alias pattern
 * (alias@inbox.getfamilyassistant.com), which catches it in any header
 * (To, Delivered-To, Received, X-Original-To, etc.) regardless of whether
 * the email was forwarded and the To header shows the original recipient.
 *
 * Usage:
 *   pnpm clear-ses --alias <alias>
 *   pnpm clear-ses --alias <alias> --dry-run
 *
 * Options:
 *   --alias <alias>   Alias to clear (e.g. "toby" for toby@inbox.getfamilyassistant.com)
 *   --dry-run         List matching emails without deleting them
 */

import { config } from 'dotenv';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

config();

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const alias   = getArg('--alias');
const dryRun  = hasFlag('--dry-run');

if (!alias) {
  console.error('Error: --alias <alias> is required (e.g. --alias toby)');
  process.exit(1);
}

const targetAlias = alias.toLowerCase();

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

const S3_BUCKET = 'getfamilyassistant-inbound-emails';

function buildS3Client(): S3Client {
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env');
    process.exit(1);
  }

  return new S3Client({
    region: process.env.AWS_REGION ?? 'eu-north-1',
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function listAllS3Keys(s3: S3Client): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function fetchFromS3(s3: S3Client, key: string): Promise<Buffer> {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  if (!Body) throw new Error(`S3 returned empty body for ${key}`);
  return Buffer.from(await Body.transformToByteArray());
}

async function deleteKeys(s3: S3Client, keys: string[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      console.log(`  deleted  ${key}`);
      deleted++;
    } catch (err: any) {
      console.error(`  FAILED   ${key} — ${err.message}`);
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const s3 = buildS3Client();

  console.log(`Listing all objects in s3://${S3_BUCKET} ...`);
  const allKeys = await listAllS3Keys(s3);

  if (allKeys.length === 0) {
    console.log('Bucket is empty.');
    return;
  }

  console.log(`Found ${allKeys.length} email(s). Scanning for alias "${targetAlias}"...\n`);

  const matchingKeys: string[] = [];
  let scanned = 0;
  let failed  = 0;

  for (const key of allKeys) {
    scanned++;
    process.stdout.write(`\r  Scanning ${scanned}/${allKeys.length}...`);

    try {
      const buffer = await fetchFromS3(s3, key);
      // Search raw bytes — catches the alias in any header (To, Delivered-To,
      // Received, X-Original-To, etc.) regardless of email forwarding.
      const needle = `${targetAlias}@inbox.getfamilyassistant.com`;
      if (buffer.toString('latin1').toLowerCase().includes(needle)) {
        matchingKeys.push(key);
      }
    } catch (err: any) {
      failed++;
      // Non-fatal: log after scan completes
    }
  }

  process.stdout.write('\n\n');

  if (matchingKeys.length === 0) {
    console.log(`No emails found for alias "${targetAlias}".`);
    if (failed > 0) console.log(`(${failed} email(s) could not be parsed)`);
    return;
  }

  console.log(`Found ${matchingKeys.length} email(s) for alias "${targetAlias}":`)
  for (const key of matchingKeys) {
    console.log(`  ${key}`);
  }

  if (failed > 0) {
    console.log(`\n(${failed} email(s) could not be parsed and were skipped)`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no emails deleted.');
    return;
  }

  console.log(`\nDeleting ${matchingKeys.length} email(s)...`);
  const deleted = await deleteKeys(s3, matchingKeys);
  console.log(`\nDone. ${deleted}/${matchingKeys.length} email(s) deleted from s3://${S3_BUCKET}.`);
}

main().catch(err => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
