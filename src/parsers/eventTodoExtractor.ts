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

/**
 * Build enhanced AI prompt for event and todo extraction
 * Implements Task 1.9 requirements: human analysis, recurring detection, inference
 */
function buildEnhancedExtractionPrompt(emails: EmailMetadata[], currentDate: Date): string {
  const emailSummaries = emails
    .map(
      (email, index) =>
        `[Email ${index + 1}]
From: ${email.fromName} <${email.from}>
Subject: ${email.subject}
Date: ${email.receivedAt}
Body Preview: ${email.snippet}
${email.bodyText ? `\n\nFull Body:\n${email.bodyText.substring(0, 3000)}` : ''}
${email.attachmentContent ? `\n\n=== ATTACHMENT CONTENT ===\n${email.attachmentContent.substring(0, 2000)}` : ''}
---
`
    )
    .join('\n');

  const currentDateStr = currentDate.toISOString().split('T')[0];
  const currentYear = currentDate.getFullYear();

  return `You are an AI assistant that analyzes school-related emails and extracts key information.
Today's date is: ${currentDateStr}

**Your task:**
Analyze each email and provide:
1. **Human-Readable Analysis** - Summary, tone, and intent of the email
2. **Events** - Dates and events for the calendar (with recurring detection)
3. **Todos/Actions** - Things requiring parent action (with recurring detection)

=== SECTION 1: HUMAN ANALYSIS ===

For the overall batch of emails, provide:
- **email_summary**: Brief summary of what these emails are about (1-2 sentences)
- **email_tone**: Overall tone (informative, urgent, casual, formal, friendly, etc.)
- **email_intent**: Primary intent (action required, information only, reminder, invitation, etc.)
- **implicit_context**: Any implicit assumptions or shared context (e.g., "assumes reader knows school calendar")

=== SECTION 2: EVENT EXTRACTION ===

**Event Rules:**
1. Extract ALL events with specific dates
2. Mark each event with:
   - **recurring**: true if it happens regularly (weekly PE, monthly meetings, etc.)
   - **recurrence_pattern**: describe the pattern if recurring (e.g., "weekly on Tuesdays")
   - **time_of_day**: categorize as morning/afternoon/evening/all_day/specific
   - **inferred_date**: true if you had to infer the date from context

**Time Defaults (use when exact time not specified):**
- morning → 09:00:00
- afternoon → 12:00:00
- evening → 17:00:00
- all_day → 09:00:00 (start time)

**Date Inference Rules:**
- "tomorrow" → next day from email date
- "next Monday" → calculate actual date
- "this Friday" → calculate actual date
- If year not mentioned, assume ${currentYear} or ${currentYear + 1} (whichever makes sense)
- Mark inferred_date=true when inferring

**Recurring Event Detection:**
- PE days, swimming lessons → usually weekly
- After-school clubs → usually weekly
- Assembly, chapel → often weekly
- Parent evenings → usually termly (not recurring)
- School trips → usually one-off

=== SECTION 3: TODO EXTRACTION ===

**Todo Type Classification:**
- **PAY**: Payment required (extract amount and URL)
- **BUY**: Need to purchase from shop
- **PACK**: Need to pack/send item from home
- **SIGN**: Need to sign a document/form
- **FILL**: Need to complete a form/questionnaire
- **READ**: Need to read document/attachment
- **REMIND**: General reminder (default)

**Todo Rules:**
1. Extract BOTH explicit AND reasonably inferred actions
2. Mark each todo with:
   - **recurring**: true if it happens regularly
   - **recurrence_pattern**: describe the pattern if recurring
   - **responsible_party**: "parent", "child", or "both"
   - **inferred**: true if action was implied, not explicitly stated

**Inference Examples:**
- "PE is on Tuesdays" → inferred todo: "Pack PE kit" (recurring, every Tuesday, inferred=true)
- "Trip costs £15" → explicit todo: "Pay £15" (not inferred)
- "Please read the attached newsletter" → explicit todo: "Read newsletter" (not inferred)
- "Swimming starts next term" → inferred todo: "Pack swimming kit" (recurring, inferred=true)

**Due Date Rules:**
- For PACK items: due date = when item is needed (the event date)
- For PAY items: due date = payment deadline (often before event)
- If no deadline mentioned, use the event date or null
- Use ISO8601 format with time defaults

=== EXAMPLES ===

**Example 1: Simple Reminder**
Email: "Reminder: PE is every Tuesday and Friday. Please ensure your child has their PE kit."

Analysis:
- recurring: true
- recurrence_pattern: "weekly on Tuesdays and Fridays"
- Creates 2 events (PE Tuesday, PE Friday) marked as recurring
- Creates todo "Pack PE kit" marked as recurring

**Example 2: One-off Trip**
Email: "Year 3 trip to the Science Museum on Friday 24th January. Cost £12, payment due by 20th Jan."

Analysis:
- Event: "Year 3 trip to Science Museum" on 2026-01-24T09:00:00 (morning, not recurring)
- Todo 1: "Pay £12 for Science Museum trip" due 2026-01-20T23:59:00 (PAY, not recurring)
- Todo 2: "Pack lunch for Science Museum trip" due 2026-01-24T09:00:00 (PACK, inferred, not recurring)

---

**Emails to analyze (${emails.length} total):**

${emailSummaries}

**Output Requirements:**
- Return valid JSON with human_analysis, events, todos, emails_analyzed
- All dates must be ISO8601 format (e.g., "2026-01-20T09:00:00Z")
- Set confidence scores honestly (0.5-1.0)
- Include recurring and inferred flags for all items
- Empty arrays are fine if nothing found
`;
}

/**
 * Build legacy prompt for backward compatibility
 */
function buildExtractionPrompt(emails: EmailMetadata[]): string {
  return buildEnhancedExtractionPrompt(emails, new Date());
}

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
async function extractWithOpenAI(emails: EmailMetadata[]): Promise<EnhancedExtractionResult> {
  console.log('🔍 Extracting events and todos with OpenAI (enhanced prompt)...');

  const openai = getOpenAIClient();
  const prompt = buildEnhancedExtractionPrompt(emails, new Date());

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant that extracts key events and action items from school emails.
You provide both human-readable analysis and structured JSON output.
You can infer reasonable actions from context (mark them as inferred=true).
You detect recurring patterns in events and todos.
Always respond with valid JSON matching the provided schema.`,
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
async function extractWithAnthropic(emails: EmailMetadata[]): Promise<EnhancedExtractionResult> {
  console.log('🔍 Extracting events and todos with Anthropic (enhanced prompt)...');

  const anthropic = getAnthropicClient();
  const prompt = buildEnhancedExtractionPrompt(emails, new Date());

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    temperature: 0.3,
    system: `You are an AI assistant that extracts key events and action items from school emails.
You provide both human-readable analysis and structured JSON output.
You can infer reasonable actions from context (mark them as inferred=true).
You detect recurring patterns in events and todos.
Always respond with valid JSON matching the schema provided in the user message.`,
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
 */
export async function extractEventsAndTodosEnhanced(
  emails: EmailMetadata[],
  provider: 'openai' | 'anthropic' = 'openai'
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
    return extractWithOpenAI(emails);
  } else {
    return extractWithAnthropic(emails);
  }
}
