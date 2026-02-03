// src/utils/senderScoreCalculator.ts
//
// Calculates sender relevance scores from user's graded feedback.
// Uses Laplace smoothing to handle sparse data.

import db from '../db/db.js';
import { updateSenderFilterScore, getLowScoreSenders, type SenderFilter } from '../db/senderFilterDb.js';

/**
 * Sender score data from relevance feedback
 */
export interface SenderScore {
  sender_email: string;
  relevant_count: number;
  not_relevant_count: number;
  total_count: number;
  relevance_score: number;
}

/**
 * Low relevance sender warning
 */
export interface LowRelevanceSender {
  sender_email: string;
  sender_name?: string;
  relevance_score: number;
  relevant_count: number;
  not_relevant_count: number;
  total_graded: number;
  recommendation: string;
}

/**
 * Minimum graded items required before calculating a score.
 * Ensures statistical significance.
 */
const MIN_GRADED_ITEMS = 3;

/**
 * Calculate sender scores from relevance feedback data.
 * Uses Laplace smoothing: (relevant + 1) / (total + 2)
 * This gives a prior of 0.5 for senders with no data.
 *
 * @param userId - User ID to calculate scores for
 * @returns Array of sender scores
 */
export function calculateSenderScores(userId: string): SenderScore[] {
  // Aggregate graded feedback by source_sender
  const stmt = db.prepare(`
    SELECT
      source_sender,
      SUM(CASE WHEN is_relevant = 1 THEN 1 ELSE 0 END) as relevant_count,
      SUM(CASE WHEN is_relevant = 0 THEN 1 ELSE 0 END) as not_relevant_count,
      COUNT(*) as total_count
    FROM relevance_feedback
    WHERE user_id = ? AND is_relevant IS NOT NULL AND source_sender IS NOT NULL
    GROUP BY source_sender
    HAVING COUNT(*) >= ?
  `);

  const rows = stmt.all(userId, MIN_GRADED_ITEMS) as {
    source_sender: string;
    relevant_count: number;
    not_relevant_count: number;
    total_count: number;
  }[];

  return rows.map((row) => {
    // Laplace smoothing: (relevant + 1) / (total + 2)
    // Gives prior of 0.5, adjusts toward actual ratio with more data
    const relevanceScore = (row.relevant_count + 1) / (row.total_count + 2);

    return {
      sender_email: row.source_sender,
      relevant_count: row.relevant_count,
      not_relevant_count: row.not_relevant_count,
      total_count: row.total_count,
      relevance_score: Math.round(relevanceScore * 100) / 100, // Round to 2 decimal places
    };
  });
}

/**
 * Update sender_filters table with calculated scores.
 * Only updates senders that have enough graded items for statistical significance.
 *
 * @param userId - User ID to update scores for
 * @returns Number of sender filters updated
 */
export function updateSenderFilterScores(userId: string): number {
  const scores = calculateSenderScores(userId);
  let updated = 0;

  for (const score of scores) {
    const success = updateSenderFilterScore(
      userId,
      score.sender_email,
      score.relevant_count,
      score.not_relevant_count,
      score.relevance_score
    );
    if (success) {
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[senderScoreCalculator] Updated ${updated} sender scores for user ${userId}`);
  }

  return updated;
}

/**
 * Get senders with low relevance scores that might warrant exclusion.
 *
 * @param userId - User ID to check
 * @param threshold - Score threshold below which to warn (default 0.3 = 30%)
 * @returns Array of low relevance senders with recommendations
 */
export function getLowRelevanceSenders(
  userId: string,
  threshold: number = 0.3
): LowRelevanceSender[] {
  const lowScoreSenders = getLowScoreSenders(userId, threshold);

  return lowScoreSenders.map((sender) => {
    const totalGraded = (sender.relevant_count || 0) + (sender.not_relevant_count || 0);
    const score = sender.relevance_score || 0;

    let recommendation: string;
    if (score < 0.15) {
      recommendation = 'Consider excluding this sender - very low relevance';
    } else if (score < 0.25) {
      recommendation = 'This sender has low relevance - you may want to exclude it';
    } else {
      recommendation = 'This sender has marginal relevance - monitor or consider excluding';
    }

    return {
      sender_email: sender.sender_email,
      sender_name: sender.sender_name,
      relevance_score: score,
      relevant_count: sender.relevant_count || 0,
      not_relevant_count: sender.not_relevant_count || 0,
      total_graded: totalGraded,
      recommendation,
    };
  });
}

/**
 * Get sender scores as a Map for quick lookup.
 * Useful for blending with AI-generated scores.
 *
 * @param userId - User ID to get scores for
 * @returns Map of sender email to relevance score (0-1)
 */
export function getSenderScoreMap(userId: string): Map<string, number> {
  const scores = calculateSenderScores(userId);
  const scoreMap = new Map<string, number>();

  for (const score of scores) {
    scoreMap.set(score.sender_email.toLowerCase(), score.relevance_score);
  }

  return scoreMap;
}
