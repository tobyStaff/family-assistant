// src/db/metricsDb.ts
import db from './db.js';

/**
 * AI metrics record for tracking performance
 */
export interface AIMetrics {
  id?: number;
  user_id: string;
  timestamp?: Date;
  provider: 'openai' | 'anthropic';

  // Email processing stats
  emails_total: number;
  emails_signal: number;
  emails_noise: number;

  // Content extraction stats
  attachments_total?: number;
  attachments_extracted?: number;
  attachments_failed?: number;

  // AI output quality
  validation_passed: boolean;
  validation_errors?: string; // JSON array

  // Response timing
  response_time_ms?: number;

  // Output stats
  financials_count?: number;
  calendar_updates_count?: number;
  attachments_review_count?: number;
  kit_tomorrow_count?: number;

  // Schema validation (OpenAI only)
  schema_validated?: boolean;
}

/**
 * Aggregated metrics for dashboard
 */
export interface AggregatedMetrics {
  // Overall stats
  total_runs: number;
  success_rate: number; // % of validations passed
  avg_response_time_ms: number;

  // Email stats
  avg_emails_total: number;
  avg_signal_ratio: number; // % of emails classified as signal

  // Extraction stats
  total_attachments: number;
  extraction_success_rate: number; // % extracted successfully

  // Output quality
  avg_financials: number;
  avg_calendar_updates: number;
  avg_attachments_review: number;

  // Provider comparison
  openai_runs: number;
  anthropic_runs: number;
}

/**
 * Time-series metrics point
 */
export interface MetricsTimeSeries {
  date: string; // YYYY-MM-DD
  total_runs: number;
  success_rate: number;
  avg_response_time_ms: number;
  avg_emails_total: number;
}

/**
 * Insert AI metrics record
 */
const insertMetricsStmt = db.prepare(`
  INSERT INTO ai_metrics (
    user_id,
    provider,
    emails_total,
    emails_signal,
    emails_noise,
    attachments_total,
    attachments_extracted,
    attachments_failed,
    validation_passed,
    validation_errors,
    response_time_ms,
    financials_count,
    calendar_updates_count,
    attachments_review_count,
    kit_tomorrow_count,
    schema_validated
  ) VALUES (
    @user_id,
    @provider,
    @emails_total,
    @emails_signal,
    @emails_noise,
    @attachments_total,
    @attachments_extracted,
    @attachments_failed,
    @validation_passed,
    @validation_errors,
    @response_time_ms,
    @financials_count,
    @calendar_updates_count,
    @attachments_review_count,
    @kit_tomorrow_count,
    @schema_validated
  )
`);

/**
 * Record AI metrics
 */
export function recordAIMetrics(metrics: AIMetrics): number {
  const result = insertMetricsStmt.run({
    user_id: metrics.user_id,
    provider: metrics.provider,
    emails_total: metrics.emails_total,
    emails_signal: metrics.emails_signal,
    emails_noise: metrics.emails_noise,
    attachments_total: metrics.attachments_total ?? null,
    attachments_extracted: metrics.attachments_extracted ?? null,
    attachments_failed: metrics.attachments_failed ?? null,
    validation_passed: metrics.validation_passed ? 1 : 0,
    validation_errors: metrics.validation_errors ?? null,
    response_time_ms: metrics.response_time_ms ?? null,
    financials_count: metrics.financials_count ?? null,
    calendar_updates_count: metrics.calendar_updates_count ?? null,
    attachments_review_count: metrics.attachments_review_count ?? null,
    kit_tomorrow_count: metrics.kit_tomorrow_count ?? null,
    schema_validated: metrics.schema_validated ? 1 : 0,
  });

  return result.lastInsertRowid as number;
}

/**
 * Get aggregated metrics for a user
 */
const getAggregatedMetricsStmt = db.prepare(`
  SELECT
    COUNT(*) as total_runs,
    CAST(SUM(CASE WHEN validation_passed = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 as success_rate,
    AVG(response_time_ms) as avg_response_time_ms,
    AVG(emails_total) as avg_emails_total,
    CAST(AVG(CAST(emails_signal AS FLOAT) / NULLIF(emails_total, 0)) AS FLOAT) * 100 as avg_signal_ratio,
    SUM(attachments_total) as total_attachments,
    CASE
      WHEN SUM(attachments_total) > 0
      THEN CAST(SUM(attachments_extracted) AS FLOAT) / SUM(attachments_total) * 100
      ELSE 0
    END as extraction_success_rate,
    AVG(financials_count) as avg_financials,
    AVG(calendar_updates_count) as avg_calendar_updates,
    AVG(attachments_review_count) as avg_attachments_review,
    SUM(CASE WHEN provider = 'openai' THEN 1 ELSE 0 END) as openai_runs,
    SUM(CASE WHEN provider = 'anthropic' THEN 1 ELSE 0 END) as anthropic_runs
  FROM ai_metrics
  WHERE user_id = ?
    AND timestamp >= datetime('now', '-30 days')
`);

export function getAggregatedMetrics(userId: string): AggregatedMetrics | null {
  const row = getAggregatedMetricsStmt.get(userId) as any;

  if (!row || row.total_runs === 0) {
    return null;
  }

  return {
    total_runs: row.total_runs,
    success_rate: row.success_rate || 0,
    avg_response_time_ms: row.avg_response_time_ms || 0,
    avg_emails_total: row.avg_emails_total || 0,
    avg_signal_ratio: row.avg_signal_ratio || 0,
    total_attachments: row.total_attachments || 0,
    extraction_success_rate: row.extraction_success_rate || 0,
    avg_financials: row.avg_financials || 0,
    avg_calendar_updates: row.avg_calendar_updates || 0,
    avg_attachments_review: row.avg_attachments_review || 0,
    openai_runs: row.openai_runs || 0,
    anthropic_runs: row.anthropic_runs || 0,
  };
}

/**
 * Get time-series metrics for charts
 */
const getTimeSeriesMetricsStmt = db.prepare(`
  SELECT
    DATE(timestamp) as date,
    COUNT(*) as total_runs,
    CAST(SUM(CASE WHEN validation_passed = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 as success_rate,
    AVG(response_time_ms) as avg_response_time_ms,
    AVG(emails_total) as avg_emails_total
  FROM ai_metrics
  WHERE user_id = ?
    AND timestamp >= datetime('now', '-30 days')
  GROUP BY DATE(timestamp)
  ORDER BY DATE(timestamp) ASC
`);

export function getTimeSeriesMetrics(userId: string): MetricsTimeSeries[] {
  const rows = getTimeSeriesMetricsStmt.all(userId) as any[];

  return rows.map(row => ({
    date: row.date,
    total_runs: row.total_runs,
    success_rate: row.success_rate || 0,
    avg_response_time_ms: row.avg_response_time_ms || 0,
    avg_emails_total: row.avg_emails_total || 0,
  }));
}

/**
 * Get recent metrics for a user (last 10 runs)
 */
const getRecentMetricsStmt = db.prepare(`
  SELECT
    id,
    timestamp,
    provider,
    emails_total,
    emails_signal,
    emails_noise,
    attachments_total,
    attachments_extracted,
    validation_passed,
    response_time_ms,
    financials_count,
    calendar_updates_count,
    schema_validated
  FROM ai_metrics
  WHERE user_id = ?
  ORDER BY timestamp DESC
  LIMIT 10
`);

export function getRecentMetrics(userId: string): AIMetrics[] {
  const rows = getRecentMetricsStmt.all(userId) as any[];

  return rows.map(row => ({
    id: row.id,
    user_id: userId,
    timestamp: new Date(row.timestamp),
    provider: row.provider,
    emails_total: row.emails_total,
    emails_signal: row.emails_signal,
    emails_noise: row.emails_noise,
    attachments_total: row.attachments_total,
    attachments_extracted: row.attachments_extracted,
    attachments_failed: row.attachments_failed,
    validation_passed: row.validation_passed === 1,
    response_time_ms: row.response_time_ms,
    financials_count: row.financials_count,
    calendar_updates_count: row.calendar_updates_count,
    attachments_review_count: row.attachments_review_count,
    kit_tomorrow_count: row.kit_tomorrow_count,
    schema_validated: row.schema_validated === 1,
  }));
}

/**
 * Delete old metrics (older than 90 days)
 */
const deleteOldMetricsStmt = db.prepare(`
  DELETE FROM ai_metrics
  WHERE timestamp < datetime('now', '-90 days')
`);

export function deleteOldMetrics(): number {
  const result = deleteOldMetricsStmt.run();
  return result.changes;
}
