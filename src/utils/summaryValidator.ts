// src/utils/summaryValidator.ts
import type { SchoolSummary } from '../types/summary.js';

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate email count is a valid number
 */
function isValidCount(count: number): boolean {
  return Number.isInteger(count) && count >= 0;
}

/**
 * Validate ISO 8601 date string
 */
function isValidISODate(dateString: string): boolean {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Validate URL format
 */
function isValidURL(urlString: string): boolean {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate SchoolSummary against expected data
 *
 * This function performs comprehensive validation to catch AI hallucination
 * and data quality issues before the summary is rendered and sent to users.
 *
 * @param summary - AI-generated school summary
 * @param expectedEmailCount - Actual number of emails sent to AI
 * @returns ValidationResult with errors and warnings
 */
export function validateSchoolSummary(
  summary: SchoolSummary,
  expectedEmailCount: number
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ============================================
  // CRITICAL: Email Analysis Validation
  // ============================================

  // Validate email_analysis exists
  if (!summary.email_analysis) {
    errors.push('Missing email_analysis field');
    return { valid: false, errors, warnings };
  }

  // CRITICAL: Total received must match what we sent
  if (!isValidCount(summary.email_analysis.total_received)) {
    errors.push(
      `Invalid total_received: ${summary.email_analysis.total_received} (must be non-negative integer)`
    );
  } else if (summary.email_analysis.total_received !== expectedEmailCount) {
    errors.push(
      `Email count mismatch: AI reported ${summary.email_analysis.total_received} but we sent ${expectedEmailCount}. AI may be hallucinating.`
    );
  }

  // Validate signal and noise counts
  if (!isValidCount(summary.email_analysis.signal_count)) {
    errors.push(
      `Invalid signal_count: ${summary.email_analysis.signal_count} (must be non-negative integer)`
    );
  }

  if (!isValidCount(summary.email_analysis.noise_count)) {
    errors.push(
      `Invalid noise_count: ${summary.email_analysis.noise_count} (must be non-negative integer)`
    );
  }

  // CRITICAL: Signal + Noise must equal Total
  const sum = summary.email_analysis.signal_count + summary.email_analysis.noise_count;
  if (isValidCount(summary.email_analysis.signal_count) &&
      isValidCount(summary.email_analysis.noise_count) &&
      isValidCount(summary.email_analysis.total_received)) {
    if (sum !== summary.email_analysis.total_received) {
      errors.push(
        `Signal (${summary.email_analysis.signal_count}) + Noise (${summary.email_analysis.noise_count}) = ${sum}, but Total is ${summary.email_analysis.total_received}`
      );
    }
  }

  // Validate noise_examples is an array
  if (!Array.isArray(summary.email_analysis.noise_examples)) {
    errors.push('noise_examples must be an array');
  }

  // ============================================
  // Summary Array Validation
  // ============================================

  if (!Array.isArray(summary.summary)) {
    errors.push('summary must be an array');
  } else {
    summary.summary.forEach((item, idx) => {
      if (!item.child || typeof item.child !== 'string' || item.child.trim() === '') {
        warnings.push(`Summary item ${idx + 1}: Missing or empty child name`);
      }
      if (!item.icon || typeof item.icon !== 'string') {
        warnings.push(`Summary item ${idx + 1}: Missing icon`);
      }
      if (!item.text || typeof item.text !== 'string' || item.text.trim() === '') {
        warnings.push(`Summary item ${idx + 1}: Missing or empty text`);
      }
    });
  }

  // ============================================
  // Kit List Validation
  // ============================================

  if (!summary.kit_list) {
    errors.push('Missing kit_list field');
  } else {
    if (!Array.isArray(summary.kit_list.tomorrow)) {
      errors.push('kit_list.tomorrow must be an array');
    }
    if (!Array.isArray(summary.kit_list.upcoming)) {
      errors.push('kit_list.upcoming must be an array');
    }
  }

  // ============================================
  // Financials Validation
  // ============================================

  if (!Array.isArray(summary.financials)) {
    errors.push('financials must be an array');
  } else {
    summary.financials.forEach((fin, idx) => {
      // Validate required fields
      if (!fin.description || fin.description.trim() === '') {
        errors.push(`Financial item ${idx + 1}: Missing description`);
      }
      if (!fin.amount || fin.amount.trim() === '') {
        errors.push(`Financial item ${idx + 1}: Missing amount`);
      }
      if (!fin.deadline) {
        errors.push(`Financial item ${idx + 1}: Missing deadline`);
      } else if (!isValidISODate(fin.deadline)) {
        errors.push(`Financial item ${idx + 1}: Invalid date format "${fin.deadline}" (must be ISO8601)`);
      }

      // Validate URL if not manual_check_required
      if (!fin.url) {
        warnings.push(`Financial item ${idx + 1}: Missing URL`);
      } else if (fin.url !== 'manual_check_required' && !isValidURL(fin.url)) {
        warnings.push(`Financial item ${idx + 1}: Invalid URL format "${fin.url}"`);
      }

      // Validate payment method if present
      if (fin.payment_method && fin.payment_method.trim() === '') {
        warnings.push(`Financial item ${idx + 1}: Empty payment_method (should be omitted if unknown)`);
      }
    });
  }

  // ============================================
  // Attachments Validation
  // ============================================

  if (!Array.isArray(summary.attachments_requiring_review)) {
    errors.push('attachments_requiring_review must be an array');
  } else {
    summary.attachments_requiring_review.forEach((att, idx) => {
      if (!att.subject || att.subject.trim() === '') {
        warnings.push(`Attachment ${idx + 1}: Missing subject`);
      }
      if (!att.from || att.from.trim() === '') {
        warnings.push(`Attachment ${idx + 1}: Missing from`);
      }
      if (!att.reason || att.reason.trim() === '') {
        warnings.push(`Attachment ${idx + 1}: Missing reason`);
      }
    });
  }

  // ============================================
  // Calendar Updates Validation
  // ============================================

  if (!Array.isArray(summary.calendar_updates)) {
    errors.push('calendar_updates must be an array');
  } else {
    summary.calendar_updates.forEach((cal, idx) => {
      if (!cal.event || cal.event.trim() === '') {
        warnings.push(`Calendar update ${idx + 1}: Missing event`);
      }
      if (!cal.date) {
        errors.push(`Calendar update ${idx + 1}: Missing date`);
      } else if (!isValidISODate(cal.date)) {
        errors.push(`Calendar update ${idx + 1}: Invalid date format "${cal.date}" (must be ISO8601)`);
      }
      if (!cal.action || cal.action.trim() === '') {
        warnings.push(`Calendar update ${idx + 1}: Missing action`);
      }
    });
  }

  // ============================================
  // Pro Dad Insight Validation
  // ============================================

  if (!summary.pro_dad_insight) {
    warnings.push('Missing pro_dad_insight');
  } else if (typeof summary.pro_dad_insight !== 'string') {
    errors.push('pro_dad_insight must be a string');
  } else if (summary.pro_dad_insight.trim() === '') {
    warnings.push('pro_dad_insight is empty');
  } else if (summary.pro_dad_insight.length < 10) {
    warnings.push('pro_dad_insight is suspiciously short (less than 10 characters)');
  }

  // ============================================
  // Return Validation Result
  // ============================================

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for logging
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push('ERRORS:');
    result.errors.forEach((err, idx) => {
      lines.push(`  ${idx + 1}. ${err}`);
    });
  }

  if (result.warnings.length > 0) {
    lines.push('WARNINGS:');
    result.warnings.forEach((warn, idx) => {
      lines.push(`  ${idx + 1}. ${warn}`);
    });
  }

  return lines.join('\n');
}
