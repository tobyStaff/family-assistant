// src/db/onboardingScanDb.ts

import db from './db.js';

export type JobStatus = 'pending' | 'scanning' | 'ranking' | 'complete' | 'failed';
export type JobType = 'scan_inbox' | 'extract_training' | 'generate_email' | 'analyze_children' | 'process_hosted';

export interface OnboardingJob {
  id: number;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  result_json: string | null;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
}

export interface ScanResult {
  senders: any[];
  total_emails: number;
}

export interface ExtractResult {
  items: any[];
  emailCount: number;
}

export interface GenerateEmailResult {
  sent: boolean;
  recipients: string[];
  emailsAnalyzed: number;
}

/**
 * Create a new job record
 */
export function createJob(userId: string, jobType: JobType): number {
  // Delete any existing jobs of this type for this user (only keep latest)
  // COALESCE handles legacy NULL job_type records (treats them as 'scan_inbox')
  db.prepare('DELETE FROM onboarding_scans WHERE user_id = ? AND COALESCE(job_type, \'scan_inbox\') = ?').run(userId, jobType);

  const result = db.prepare(`
    INSERT INTO onboarding_scans (user_id, status, job_type)
    VALUES (?, 'pending', ?)
  `).run(userId, jobType);

  return result.lastInsertRowid as number;
}

// Backwards compatible alias
export function createScan(userId: string): number {
  return createJob(userId, 'scan_inbox');
}

/**
 * Update job status
 */
export function updateJobStatus(jobId: number, status: JobStatus): void {
  db.prepare(`
    UPDATE onboarding_scans
    SET status = ?
    WHERE id = ?
  `).run(status, jobId);
}

// Backwards compatible alias
export function updateScanStatus(scanId: number, status: JobStatus): void {
  updateJobStatus(scanId, status);
}

/**
 * Mark job as complete with results
 */
export function completeJob(jobId: number, result: any): void {
  db.prepare(`
    UPDATE onboarding_scans
    SET status = 'complete',
        result_json = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(result), jobId);
}

// Backwards compatible alias
export function completeScan(scanId: number, result: ScanResult): void {
  completeJob(scanId, result);
}

/**
 * Mark job as failed with error
 */
export function failJob(jobId: number, errorMessage: string): void {
  db.prepare(`
    UPDATE onboarding_scans
    SET status = 'failed',
        error_message = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMessage, jobId);
}

// Backwards compatible alias
export function failScan(scanId: number, errorMessage: string): void {
  failJob(scanId, errorMessage);
}

/**
 * Get the latest job for a user by type
 */
export function getLatestJob(userId: string, jobType: JobType): OnboardingJob | null {
  // Handle both new records with job_type and old records where job_type might be NULL
  // COALESCE treats NULL job_type as 'scan_inbox' for backwards compatibility
  const row = db.prepare(`
    SELECT * FROM onboarding_scans
    WHERE user_id = ? AND COALESCE(job_type, 'scan_inbox') = ?
    ORDER BY started_at DESC
    LIMIT 1
  `).get(userId, jobType) as any;

  if (!row) return null;

  return {
    id: row.id,
    user_id: row.user_id,
    job_type: row.job_type || 'scan_inbox',
    status: row.status,
    result_json: row.result_json,
    error_message: row.error_message,
    started_at: new Date(row.started_at),
    completed_at: row.completed_at ? new Date(row.completed_at) : null,
  };
}

// Backwards compatible alias
export function getLatestScan(userId: string): OnboardingJob | null {
  return getLatestJob(userId, 'scan_inbox');
}

/**
 * Get job result parsed as object
 */
export function getJobResult<T = any>(userId: string, jobType: JobType): T | null {
  const job = getLatestJob(userId, jobType);
  if (!job || job.status !== 'complete' || !job.result_json) {
    return null;
  }

  try {
    return JSON.parse(job.result_json);
  } catch {
    return null;
  }
}

// Backwards compatible alias
export function getScanResult(userId: string): ScanResult | null {
  return getJobResult<ScanResult>(userId, 'scan_inbox');
}

/**
 * Check if a job is currently in progress
 * Jobs older than 5 minutes are considered stale (server may have restarted)
 */
export function isJobInProgress(userId: string, jobType: JobType): boolean {
  const job = getLatestJob(userId, jobType);
  if (!job) return false;

  const inProgressStatuses = ['pending', 'scanning', 'ranking'];
  if (!inProgressStatuses.includes(job.status)) return false;

  // Check if job is stale (started more than 5 minutes ago)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (job.started_at < fiveMinutesAgo) {
    console.log(`[isJobInProgress] Job ${job.id} is stale (started ${job.started_at.toISOString()}), treating as not in progress`);
    return false;
  }

  return true;
}

// Backwards compatible alias
export function isScanInProgress(userId: string): boolean {
  return isJobInProgress(userId, 'scan_inbox');
}

/**
 * Delete old jobs (cleanup)
 */
export function deleteOldJobs(userId: string, jobType?: JobType): void {
  if (jobType) {
    db.prepare('DELETE FROM onboarding_scans WHERE user_id = ? AND job_type = ?').run(userId, jobType);
  } else {
    db.prepare('DELETE FROM onboarding_scans WHERE user_id = ?').run(userId);
  }
}

// Backwards compatible alias
export function deleteOldScans(userId: string): void {
  deleteOldJobs(userId, 'scan_inbox');
}
