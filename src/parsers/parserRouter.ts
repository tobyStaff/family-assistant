// src/parsers/parserRouter.ts
import { NlpParser, DEFAULT_KEYWORDS, KeywordsConfig } from './nlpParser.js';
import { AiParser } from './aiParser.js';
import { ParsedResult } from './IParser.js';

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

/**
 * Route email content to the appropriate parser
 * - Uses NLP parser if explicit command keywords are detected
 * - Falls back to AI parser for semantic analysis
 *
 * @param content - Email content to parse
 * @returns Parsed result or null if parsing fails
 */
export async function routeParse(content: string): Promise<ParsedResult | null> {
  if (hasCommandKeywords(content)) {
    // Use NLP parser for explicit commands
    return new NlpParser().parse(content);
  } else {
    // Use AI parser for semantic understanding
    return await new AiParser().parse(content);
  }
}
