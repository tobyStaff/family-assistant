// src/prompts/fewShotBuilder.ts
//
// Builds few-shot examples from user's graded relevance feedback
// for injection into AI extraction prompts.

import { getGradedExamplesForPrompt, type FewShotExample } from '../db/relevanceFeedbackDb.js';
import { anonymizeText, type ChildMapping } from '../utils/childAnonymizer.js';

/**
 * Result of building few-shot examples
 */
export interface FewShotBuildResult {
  promptSection: string;
  exampleCount: number;
}

/**
 * Build few-shot examples section for AI prompts.
 * Anonymizes child names using provided mappings.
 *
 * @param userId - User ID to fetch examples for
 * @param childMappings - Child name mappings for anonymization
 * @param limitPerCategory - Max examples per category (default 3)
 * @returns Object with prompt section string and total example count
 */
export function buildFewShotExamples(
  userId: string,
  childMappings: ChildMapping[] = [],
  limitPerCategory: number = 3
): FewShotBuildResult {
  const { relevant, notRelevant } = getGradedExamplesForPrompt(userId, limitPerCategory);

  const totalExamples = relevant.length + notRelevant.length;

  // If no examples, return empty
  if (totalExamples === 0) {
    return { promptSection: '', exampleCount: 0 };
  }

  // Anonymize examples
  const anonymizeExample = (example: FewShotExample): string => {
    let text = example.item_text;
    if (childMappings.length > 0) {
      text = anonymizeText(text, childMappings);
    }
    return `- ${text}`;
  };

  // Build prompt section
  let promptSection = `
=== USER-SPECIFIC RELEVANCE FILTER (CRITICAL - OVERRIDES OTHER RULES) ===

The user has explicitly graded items from their emails. These preferences OVERRIDE all other extraction rules.

`;

  if (notRelevant.length > 0) {
    promptSection += `**DO NOT EXTRACT** - The user marked these as NOT RELEVANT. Skip similar items entirely:
${notRelevant.map(anonymizeExample).join('\n')}

If an item matches the pattern or type of ANY item above, DO NOT include it in your output.
This applies even to calendar lists - user preferences override "extract all" rules.

`;
  }

  if (relevant.length > 0) {
    promptSection += `**EXTRACT** - The user confirmed these ARE RELEVANT:
${relevant.map(anonymizeExample).join('\n')}

`;
  }

  promptSection += `When you encounter an item similar to the NOT RELEVANT examples above, exclude it from your output completely.

`;

  return {
    promptSection,
    exampleCount: totalExamples,
  };
}
