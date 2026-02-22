/**
 * scripts/seedInboundEmail.ts
 *
 * Simulates the Lambda → webhook pipeline locally.
 * Parses a real .eml file (or fetches one/all from S3) and POSTs it to the
 * local inbound webhook using the exact same payload format as the Lambda.
 *
 * Usage:
 *   pnpm seed-inbound --eml <path-to-file.eml> --recipient <alias@inbox.getfamilyassistant.com>
 *   pnpm seed-inbound --s3 <messageId>          --recipient <alias@inbox.getfamilyassistant.com>
 *   pnpm seed-inbound --s3-all
 *   pnpm seed-inbound --s3-all --alias <alias>
 *
 * Options:
 *   --eml <path>         Local .eml file to replay
 *   --s3 <messageId>     Single message ID in the S3 inbound bucket to fetch and replay
 *   --s3-all             Replay every email currently in the S3 inbound bucket
 *   --alias <alias>      Filter --s3-all to only replay emails for this alias (e.g. toby)
 *   --recipient <email>  Recipient address (e.g. toby@inbox.getfamilyassistant.com)
 *                        Required for --eml and --s3. For --s3-all, extracted from each
 *                        email's To header automatically (override with this flag if needed)
 *   --url <url>          Webhook URL (default: http://localhost:3000/api/email/inbound)
 */

import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { simpleParser } from 'mailparser';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// Load .env
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

const emlPath    = getArg('--eml');
const s3Key      = getArg('--s3');
const s3All      = hasFlag('--s3-all');
const recipient  = getArg('--recipient');
const aliasFilter = getArg('--alias')?.toLowerCase();
const webhookUrl = getArg('--url') ?? 'http://localhost:3000/api/email/inbound';

const webhookSecret = process.env.HOSTED_EMAIL_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.error('Error: HOSTED_EMAIL_WEBHOOK_SECRET not set in .env');
  process.exit(1);
}

if (!emlPath && !s3Key && !s3All) {
  console.error('Error: provide --eml <path>, --s3 <messageId>, or --s3-all');
  process.exit(1);
}

if ((emlPath || s3Key) && !recipient) {
  console.error('Error: --recipient is required with --eml and --s3 (e.g. toby@inbox.getfamilyassistant.com)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

const S3_BUCKET = 'getfamilyassistant-inbound-emails';

function buildS3Client(): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set to use S3 options');
    process.exit(1);
  }

  return new S3Client({
    region: process.env.AWS_REGION ?? 'eu-north-1',
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function fetchFromS3(s3: S3Client, messageId: string): Promise<Buffer> {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: messageId }));
  if (!Body) throw new Error(`S3 returned empty body for ${messageId}`);
  return Buffer.from(await Body.transformToByteArray());
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

// ---------------------------------------------------------------------------
// Build and send a single email payload
// ---------------------------------------------------------------------------

async function sendEmail(
  buffer: Buffer,
  messageId: string,
  recipientOverride?: string,
): Promise<{ status: string; skipped?: string }> {
  const parsed = await simpleParser(buffer);

  // Determine recipient: use override, else extract from the email's To header
  const parsedTo = !Array.isArray(parsed.to) ? (parsed.to as any)?.value?.[0]?.address : undefined;
  const toAddress = recipientOverride ?? parsedTo;

  if (!toAddress) {
    return { status: 'skipped', skipped: 'could not determine recipient' };
  }

  const payload = {
    messageId,
    recipient: toAddress,
    from: parsed.from?.value[0]?.address ?? 'unknown@example.com',
    fromName: parsed.from?.value[0]?.name ?? undefined,
    subject: parsed.subject ?? '(no subject)',
    textBody: parsed.text ?? undefined,
    htmlBody: parsed.html || undefined,
    date: parsed.date?.toISOString() ?? new Date().toISOString(),
    attachments: (parsed.attachments ?? []).map(att => ({
      filename: att.filename ?? 'unnamed',
      contentType: att.contentType,
      size: att.size,
      content: att.content.toString('base64'),
    })),
    spamVerdict: 'PASS',
    virusVerdict: 'PASS',
  };

  console.log(`  from="${payload.from}" subject="${payload.subject}"`);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': webhookSecret!,
    },
    body: JSON.stringify(payload),
  });

  const body: any = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- Single .eml file ---
  if (emlPath) {
    const buffer = readFileSync(emlPath);
    const messageId = `seed-${emlPath.split('/').pop()}-${Date.now()}`;
    console.log(`Reading ${emlPath} ...`);
    const result = await sendEmail(buffer, messageId, recipient);
    console.log('Result:', result);
    return;
  }

  const s3 = buildS3Client();

  // --- Single S3 key ---
  if (s3Key) {
    console.log(`Fetching s3://${S3_BUCKET}/${s3Key} ...`);
    const buffer = await fetchFromS3(s3, s3Key);
    const result = await sendEmail(buffer, s3Key, recipient);
    console.log('Result:', result);
    return;
  }

  // --- All S3 keys ---
  console.log(`Listing all objects in s3://${S3_BUCKET} ...`);
  const keys = await listAllS3Keys(s3);

  if (keys.length === 0) {
    console.log('No emails found in bucket.');
    return;
  }

  const filterNote = aliasFilter ? ` (filtering by alias "${aliasFilter}")` : '';
  console.log(`Found ${keys.length} email(s). Replaying${filterNote}...\n`);

  let stored = 0, duplicate = 0, ignored = 0, skippedAlias = 0, failed = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const prefix = `[${i + 1}/${keys.length}]`;

    try {
      const buffer = await fetchFromS3(s3, key);

      // Apply alias filter if set — search raw bytes to catch the alias in
      // any header (To, Delivered-To, Received, etc.) regardless of forwarding.
      if (aliasFilter) {
        const needle = `${aliasFilter}@inbox.getfamilyassistant.com`;
        if (!buffer.toString('latin1').toLowerCase().includes(needle)) {
          skippedAlias++;
          continue;
        }
      }

      const result = await sendEmail(buffer, key, recipient);

      if (result.status === 'stored')         { stored++;    console.log(`${prefix} stored     ${key}`); }
      else if (result.status === 'duplicate') { duplicate++; console.log(`${prefix} duplicate  ${key}`); }
      else if (result.status === 'ignored')   {
        ignored++;
        const reason = (result as any).reason ?? (result as any).skipped ?? 'unknown';
        const extra = (result as any).urlStored !== undefined ? ` urlStored=${(result as any).urlStored}` : '';
        console.log(`${prefix} ignored    ${key} (${reason}${extra})`);
      }
      else if (result.status === 'skipped')   { ignored++;   console.log(`${prefix} skipped    ${key} — ${(result as any).skipped}`); }
      else { console.log(`${prefix} ${JSON.stringify(result)}  ${key}`); }
    } catch (err: any) {
      failed++;
      console.error(`${prefix} FAILED     ${key} — ${err.message}`);
    }
  }

  console.log('');
  const skippedNote = aliasFilter ? ` skipped_alias=${skippedAlias}` : '';
  console.log(`Done. stored=${stored} duplicate=${duplicate} ignored=${ignored} failed=${failed}${skippedNote}`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
