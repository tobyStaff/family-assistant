#!/usr/bin/env node
// src/scripts/backupDb.ts
/**
 * Database Backup Script
 * Uploads SQLite database to Google Drive for nightly backups
 *
 * Usage:
 *   node dist/scripts/backupDb.js
 *
 * Environment Variables:
 *   DB_PATH - Path to SQLite database (default: /app/data/app.db)
 *   GOOGLE_SERVICE_ACCOUNT_PATH - Path to service account JSON (default: /app/credentials.json)
 *   GOOGLE_DRIVE_FOLDER_ID - Optional: Google Drive folder ID for backups
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { Readable } from 'stream';

async function backupToGoogleDrive() {
  try {
    console.log('[Backup] Starting database backup to Google Drive...');

    // Configuration
    const dbPath = process.env.DB_PATH || '/app/data/app.db';
    const credentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || '/app/credentials.json';
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    // Validate database exists
    if (!existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }

    // Validate credentials exist
    if (!existsSync(credentialsPath)) {
      throw new Error(
        `Service account credentials not found: ${credentialsPath}\n` +
          'Please mount credentials.json in docker-compose.yml or set GOOGLE_SERVICE_ACCOUNT_PATH'
      );
    }

    console.log(`[Backup] Database: ${dbPath}`);
    console.log(`[Backup] Credentials: ${credentialsPath}`);

    // Authenticate with Google using service account
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const authClient = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: authClient as any });

    // Read database file
    const dbBuffer = readFileSync(dbPath);
    const dbStream = Readable.from(dbBuffer);

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `inbox-manager-backup-${timestamp}.db`;

    console.log(`[Backup] Uploading as: ${backupFilename}`);
    console.log(`[Backup] Size: ${(dbBuffer.length / 1024).toFixed(2)} KB`);

    // Upload to Google Drive
    const fileMetadata: any = {
      name: backupFilename,
      mimeType: 'application/octet-stream',
    };

    // If folder ID specified, upload to that folder
    if (driveFolderId) {
      fileMetadata.parents = [driveFolderId];
      console.log(`[Backup] Target folder: ${driveFolderId}`);
    }

    const media = {
      mimeType: 'application/octet-stream',
      body: dbStream,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, size, createdTime, webViewLink',
    });

    const uploadedFile = response.data;

    console.log('[Backup] ✓ Upload successful!');
    console.log(`[Backup] File ID: ${uploadedFile.id}`);
    console.log(`[Backup] Name: ${uploadedFile.name}`);
    console.log(`[Backup] Size: ${uploadedFile.size} bytes`);
    if (uploadedFile.webViewLink) {
      console.log(`[Backup] View: ${uploadedFile.webViewLink}`);
    }

    // Optional: Delete old backups (keep last 30 days)
    await cleanupOldBackups(drive, driveFolderId);

    console.log('[Backup] Backup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Backup] ✗ Backup failed:', error);
    if (error instanceof Error) {
      console.error('[Backup] Error message:', error.message);
      console.error('[Backup] Stack:', error.stack);
    }
    process.exit(1);
  }
}

/**
 * Clean up old backup files (keep last 30 days)
 */
async function cleanupOldBackups(
  drive: any,
  folderId?: string
): Promise<void> {
  try {
    console.log('[Backup] Checking for old backups to clean up...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Search for old backup files
    let query = `name contains 'inbox-manager-backup-' and mimeType='application/octet-stream' and createdTime < '${thirtyDaysAgo.toISOString()}'`;

    if (folderId) {
      query += ` and '${folderId}' in parents`;
    }

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
    });

    const oldFiles = response.data.files || [];

    if (oldFiles.length === 0) {
      console.log('[Backup] No old backups to clean up');
      return;
    }

    console.log(`[Backup] Found ${oldFiles.length} old backup(s) to delete`);

    // Delete old files
    for (const file of oldFiles) {
      try {
        await drive.files.delete({ fileId: file.id });
        console.log(`[Backup] Deleted old backup: ${file.name} (${file.createdTime})`);
      } catch (err) {
        console.error(`[Backup] Failed to delete ${file.name}:`, err);
      }
    }

    console.log('[Backup] Cleanup completed');
  } catch (error) {
    console.error('[Backup] Error during cleanup:', error);
    // Don't fail the backup if cleanup fails
  }
}

// Run backup
backupToGoogleDrive();
