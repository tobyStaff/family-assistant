// src/parsers/parserRouter.ts
import { DEFAULT_KEYWORDS, KeywordsConfig } from './nlpParser.js';

/**
 * Check if email content contains any command keywords.
 * Used to route emails to NLP parser vs AI parser.
 *
 * @param content - Email content to scan
 * @param keywords - Keyword configuration (defaults to DEFAULT_KEYWORDS)
 * @returns true if any command keyword is found
 */
export function hasCommandKeywords(
  content: string,
  keywords: KeywordsConfig = DEFAULT_KEYWORDS
): boolean {
  const lowerContent = content.toLowerCase();
  return Object.values(keywords)
    .flat()
    .some((kw: string) => lowerContent.includes(kw.toLowerCase()));
}
