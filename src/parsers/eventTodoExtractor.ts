// src/parsers/eventTodoExtractor.ts

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { EmailMetadata } from '../types/summary.js';
import type { ExtractionResult } from '../types/extraction.js';
import {
  extractionSchema,
  isValidExtractionResult,
  type EnhancedExtractionResult,
  type HumanAnalysis,
} from './extractionSchema.js';
import {
  buildEmailAnalysisPrompt,
  OPENAI_SYSTEM_PROMPT,
  ANTHROPIC_SYSTEM_PROMPT,
} from '../prompts/emailAnalysis.js';
import type { AnonymizedChildProfile } from '../utils/childAnonymizer.js';

/**
 * Lazy-load OpenAI client
 */
function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Lazy-load Anthropic client
 */
function getAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * Get default time for time_of_day category
 */
function getDefaultTimeForCategory(timeOfDay: string): string {
  switch (timeOfDay) {
    case 'morning':
      return '09:00:00';
    case 'afternoon':
      return '12:00:00';
    case 'evening':
      return '17:00:00';
    case 'all_day':
      return '09:00:00';
    default:
      return '09:00:00';
  }
}

// Prompt functions are now in src/prompts/emailAnalysis.ts

/**
 * Apply time-of-day defaults to extracted events
 */
function applyTimeDefaults(result: any): any {
  if (!result.events) return result;

  result.events = result.events.map((event: any) => {
    // If date doesn't have a specific time (ends with 00:00:00), apply default
    if (event.date && event.time_of_day && event.time_of_day !== 'specific') {
      const datePart = event.date.split('T')[0];
      const defaultTime = getDefaultTimeForCategory(event.time_of_day);
      event.date = `${datePart}T${defaultTime}Z`;
    }
    return event;
  });

  return result;
}

/**
 * Extract events and todos using OpenAI with enhanced prompt
 */
async function extractWithOpenAI(
  emails: EmailMetadata[],
  childProfiles: AnonymizedChildProfile[] = [],
  fewShotSection: string = ''
): Promise<EnhancedExtractionResult> {
  console.log('🔍 Extracting events and todos with OpenAI (enhanced prompt)...');

  const openai = getOpenAIClient();
  const prompt = buildEmailAnalysisPrompt(emails, new Date(), childProfiles, fewShotSection);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    messages: [
      {
        role: 'system',
        content: OPENAI_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'event_todo_extraction',
        strict: true,
        schema: extractionSchema,
      },
    },
    temperature: 0.3, // Slightly higher for better inference
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  let parsed = JSON.parse(content);

  if (!isValidExtractionResult(parsed)) {
    throw new Error('Invalid extraction result from OpenAI');
  }

  // Apply time defaults
  parsed = applyTimeDefaults(parsed);

  return {
    human_analysis: parsed.human_analysis || {
      email_summary: '',
      email_tone: 'informative',
      email_intent: 'information only',
      implicit_context: '',
    },
    events: parsed.events,
    todos: parsed.todos,
    emails_analyzed: parsed.emails_analyzed,
    extraction_timestamp: new Date().toISOString(),
  };
}

/**
 * Extract events and todos using Anthropic with enhanced prompt
 */
async function extractWithAnthropic(
  emails: EmailMetadata[],
  childProfiles: AnonymizedChildProfile[] = [],
  fewShotSection: string = ''
): Promise<EnhancedExtractionResult> {
  console.log('🔍 Extracting events and todos with Anthropic (enhanced prompt)...');

  const anthropic = getAnthropicClient();
  const prompt = buildEmailAnalysisPrompt(emails, new Date(), childProfiles, fewShotSection);

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 8000,
    temperature: 0.3,
    system: ANTHROPIC_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  // Try to extract JSON from the response
  let jsonText = content.text;
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  let parsed = JSON.parse(jsonText);

  if (!isValidExtractionResult(parsed)) {
    throw new Error('Invalid extraction result from Anthropic');
  }

  // Apply time defaults
  parsed = applyTimeDefaults(parsed);

  return {
    human_analysis: parsed.human_analysis || {
      email_summary: '',
      email_tone: 'informative',
      email_intent: 'information only',
      implicit_context: '',
    },
    events: parsed.events,
    todos: parsed.todos,
    emails_analyzed: parsed.emails_analyzed,
    extraction_timestamp: new Date().toISOString(),
  };
}

/**
 * Extract events and todos from emails using AI (enhanced version)
 *
 * @param emails - Array of email metadata with content
 * @param provider - AI provider to use ('openai' | 'anthropic')
 * @returns Extracted events, todos, and human analysis
 */
export async function extractEventsAndTodos(
  emails: EmailMetadata[],
  provider: 'openai' | 'anthropic' = 'openai'
): Promise<ExtractionResult> {
  if (emails.length === 0) {
    return {
      events: [],
      todos: [],
      emails_analyzed: 0,
      extraction_timestamp: new Date().toISOString(),
    };
  }

  try {
    let result: EnhancedExtractionResult;

    if (provider === 'openai') {
      result = await extractWithOpenAI(emails);
      console.log(
        `✅ OpenAI extraction complete: ${result.events.length} events, ${result.todos.length} todos`
      );
    } else {
      result = await extractWithAnthropic(emails);
      console.log(
        `✅ Anthropic extraction complete: ${result.events.length} events, ${result.todos.length} todos`
      );
    }

    // Log recurring items found
    const recurringEvents = result.events.filter((e: any) => e.recurring);
    const recurringTodos = result.todos.filter((t: any) => t.recurring);
    if (recurringEvents.length > 0 || recurringTodos.length > 0) {
      console.log(`🔄 Found ${recurringEvents.length} recurring events, ${recurringTodos.length} recurring todos`);
    }

    // Convert to legacy format for backward compatibility
    return {
      events: result.events,
      todos: result.todos,
      emails_analyzed: result.emails_analyzed,
      extraction_timestamp: result.extraction_timestamp,
      // Include enhanced data
      human_analysis: result.human_analysis,
    } as ExtractionResult;
  } catch (error: any) {
    console.error(`❌ Extraction failed with ${provider}:`, error.message);

    // Try fallback provider if primary fails
    if (provider === 'openai') {
      console.log('🔄 Falling back to Anthropic...');
      try {
        const result = await extractWithAnthropic(emails);
        console.log(
          `✅ Anthropic fallback successful: ${result.events.length} events, ${result.todos.length} todos`
        );
        return {
          events: result.events,
          todos: result.todos,
          emails_analyzed: result.emails_analyzed,
          extraction_timestamp: result.extraction_timestamp,
          human_analysis: result.human_analysis,
        } as ExtractionResult;
      } catch (fallbackError: any) {
        console.error('❌ Fallback also failed:', fallbackError.message);
        throw new Error(`Both AI providers failed: ${error.message}`);
      }
    }

    throw error;
  }
}

/**
 * Extract with enhanced output (includes human_analysis)
 * Use this for new two-pass analysis pipeline
 *
 * @param emails - Array of email metadata (with anonymized child names if profiles provided)
 * @param provider - AI provider to use
 * @param childProfiles - Anonymized child profiles for relevance filtering
 * @param fewShotSection - Optional few-shot examples section from user feedback
 */
export async function extractEventsAndTodosEnhanced(
  emails: EmailMetadata[],
  provider: 'openai' | 'anthropic' = 'openai',
  childProfiles: AnonymizedChildProfile[] = [],
  fewShotSection: string = ''
): Promise<EnhancedExtractionResult> {
  if (emails.length === 0) {
    return {
      human_analysis: {
        email_summary: 'No emails to analyze',
        email_tone: 'neutral',
        email_intent: 'none',
        implicit_context: '',
      },
      events: [],
      todos: [],
      emails_analyzed: 0,
      extraction_timestamp: new Date().toISOString(),
    };
  }

  if (provider === 'openai') {
    return extractWithOpenAI(emails, childProfiles, fewShotSection);
  } else {
    return extractWithAnthropic(emails, childProfiles, fewShotSection);
  }
}
