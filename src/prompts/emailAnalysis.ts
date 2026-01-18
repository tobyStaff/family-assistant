// src/prompts/emailAnalysis.ts
//
// Email analysis prompts for AI extraction.
// Edit these prompts to adjust how the AI analyzes emails.

import type { EmailMetadata } from '../types/summary.js';
import type { AnonymizedChildProfile } from '../utils/childAnonymizer.js';
import { formatProfilesForPrompt } from '../utils/childAnonymizer.js';

/**
 * System prompt for OpenAI
 * Defines the AI's role and behavior
 */
export const OPENAI_SYSTEM_PROMPT = `You are an AI assistant that extracts key events and action items from school emails.
You provide both human-readable analysis and structured JSON output.
You can infer reasonable actions from context (mark them as inferred=true).
You detect recurring patterns in events and todos.
Always respond with valid JSON matching the provided schema.`;

/**
 * System prompt for Anthropic
 * Defines the AI's role and behavior
 */
export const ANTHROPIC_SYSTEM_PROMPT = `You are an AI assistant that extracts key events and action items from school emails.
You provide both human-readable analysis and structured JSON output.
You can infer reasonable actions from context (mark them as inferred=true).
You detect recurring patterns in events and todos.
Always respond with valid JSON matching the schema provided in the user message.`;

/**
 * Build the user prompt for email analysis
 *
 * @param emails - Array of emails to analyze (with anonymized child names)
 * @param currentDate - Current date for context
 * @param childProfiles - Anonymized child profiles for relevance filtering
 * @returns The formatted prompt string
 */
export function buildEmailAnalysisPrompt(
  emails: EmailMetadata[],
  currentDate: Date,
  childProfiles: AnonymizedChildProfile[] = []
): string {
  const emailSummaries = formatEmailsForPrompt(emails);
  const currentDateStr = currentDate.toISOString().split('T')[0];
  const currentYear = currentDate.getFullYear();
  const childProfilesSection = buildChildProfilesSection(childProfiles);

  return `You are an AI assistant that analyzes school-related emails and extracts key information.
Today's date is: ${currentDateStr}. You will be given 1 email at a time to analyze.
${childProfilesSection}
**Your task:**
Analyze the email and provide:
1. **Human-Readable Analysis** - Summary, tone, and intent of the email
2. **Events** - Dates and events for the calendar (with recurring detection)
3. **Todos/Actions** - Things requiring parent action (with recurring detection)

=== SECTION 1: HUMAN ANALYSIS ===

For the email, provide:
- **email_summary**: Brief summary of what this email is about (1-2 sentences)
- **email_tone**: Overall tone (informative, urgent, casual, formal, friendly, etc.)
- **email_intent**: Primary intent (action required, information only, reminder, invitation, etc.)
- **implicit_context**: Any implicit assumptions or shared context (e.g., "assumes reader knows school calendar")

=== SECTION 2: EVENT EXTRACTION ===

**Event Rules:**
1. Extract ALL events with specific dates
2. Mark each event with:
   - **recurring**: true if it happens regularly.
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
- Never use the date of the email as the inferred date unless explicitly stated

**One-off vs Recurring Detection (IMPORTANT):**
- "this Wednesday", "next Friday", "on Monday" → ONE-OFF (recurring: false)
- "every Wednesday", "PE is on Tuesdays", "weekly assembly" → RECURRING (recurring: true)
- A specific date reference like "this [day]" or "next [day]" is ALWAYS one-off
- Only mark as recurring if the email explicitly states it happens regularly
- When in doubt, default to ONE-OFF (recurring: false)

**Recurring Event Examples:**
- PE days, swimming lessons → usually weekly (but only if stated as ongoing)
- After-school clubs → usually weekly (but only if stated as ongoing)
- Assembly, chapel → often weekly (but only if stated as ongoing)
- Parent evenings → usually termly (not recurring)
- School trips → usually one-off

**Event Creation Rules:**
- Only create events that are explicitly mentioned or clearly implied
- A task with a deadline is NOT automatically an event
- Do not invent events (e.g., don't create "PE Day" just because PE kit is mentioned)
- If the email is just a task/reminder with a deadline, create a todo, not an event

=== SECTION 3: TODO EXTRACTION ===

**Todo Type Classification:**
- **PAY**: Payment required (extract amount and URL)
- **BUY**: Need to purchase from shop
- **PACK**: Need to pack/send item from home (item already exists, just needs packing)
- **SIGN**: Need to sign a document/form
- **FILL**: Need to complete a form/questionnaire
- **READ**: Need to read document/attachment
- **REMIND**: General reminder, repair tasks, fix tasks, or anything that doesn't fit above categories

**Type Selection Notes:**
- "Fix", "repair", "mend" → use REMIND (these are general tasks, not PACK)
- "Pack PE kit" → use PACK (item exists, needs to be packed)
- "Buy new shoes" → use BUY (need to purchase)
- PACK is only for items that exist and need to be sent/brought to school

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
- **CRITICAL FOR RECURRING ITEMS**: Always calculate the NEXT occurrence date from the email date
  - If email is dated Sunday Nov 1 and mentions "PE on Monday" → due_date = Monday Nov 2
  - If email is dated Sunday Nov 1 and mentions "PE on Tuesday" → due_date = Tuesday Nov 3
  - Never return day names like "Monday" - always return a full ISO8601 date
  - For recurring items, create SEPARATE todos for each day (one for Monday, one for Tuesday)

=== EXAMPLES ===

**Example 1: Simple Reminder (IMPORTANT - shows correct recurring handling)**
Email dated: 2026-01-11 (Sunday)
Email: "Reminder: PE is every Monday and Tuesday. Please ensure your child has their PE kit."

Analysis:
- Creates 2 SEPARATE recurring todos (one for each day):
  - Todo 1: "Pack PE kit for Monday" (recurring: true, recurrence_pattern: "weekly on Mondays", due_date: "2026-01-12T09:00:00Z")
  - Todo 2: "Pack PE kit for Tuesday" (recurring: true, recurrence_pattern: "weekly on Tuesdays", due_date: "2026-01-13T09:00:00Z")
- Note: due_date is the NEXT occurrence calculated from the email date, NOT a day name

**Example 2: One-off Trip**
Email: "Year 3 trip to the Science Museum on Friday 24th January. Cost £12, payment due by 20th Jan."

Analysis:
- Event: "Year 3 trip to Science Museum" on 2026-01-24T09:00:00 (morning, not recurring)
- Todo 1: "Pay £12 for Science Museum trip" due 2026-01-20T23:59:00 (PAY, not recurring)
- Todo 2: "Pack lunch for Science Museum trip" due 2026-01-24T09:00:00 (PACK, inferred, not recurring)

**Example 3: One-off Task with Deadline (NO event)**
Email: "Fix Ella's PE shoes for this Wednesday morning."

Analysis:
- Events: NONE (no event is mentioned - this is just a task with a deadline)
- Todo: "Fix Ella's PE shoes" (REMIND type, due this Wednesday 09:00, recurring: false, inferred: false)

Key points:
- "this Wednesday" = specific one-off date, NOT recurring
- "Fix" = REMIND type, not PACK (repair task, not packing task)
- No event created because no event was mentioned (don't invent a "PE Day" event)

**Example 4: Recurring vs One-off Comparison**
Email A: "PE is every Wednesday" → recurring: true, recurrence_pattern: "weekly on Wednesdays"
Email B: "PE this Wednesday" → recurring: false (specific date reference)
Email C: "Don't forget PE on Wednesday" → recurring: false (assumes reader knows, one-off reminder)

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
 * Format emails into a string for the prompt
 */
function formatEmailsForPrompt(emails: EmailMetadata[]): string {
  return emails
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
}

/**
 * Build the child profiles section for relevance filtering
 */
function buildChildProfilesSection(profiles: AnonymizedChildProfile[]): string {
  if (profiles.length === 0) {
    return '';
  }

  const profilesList = formatProfilesForPrompt(profiles);
  const childIds = profiles.map((p) => p.id).join(', ');

  return `
=== CHILD PROFILES (IMPORTANT) ===

The family has these children:
${profilesList}

**Relevance Filtering Rules:**
- ONLY extract events/todos that are relevant to ${childIds} or the whole family
- IGNORE events for year groups that none of the children are in
- IGNORE events for schools that the children don't attend
- Set child_name to the appropriate child ID (${childIds}) or "General" for family-wide items
- If an event mentions a specific year group, check if any child matches before extracting

**Examples of what to IGNORE:**
- "Year 10 Parent Evening" when no child is in Year 10 → IGNORE completely
- "St Mary's School Trip" when no child attends St Mary's → IGNORE completely
- "Reception class assembly" when no child is in Reception → IGNORE completely

**Examples of what to INCLUDE:**
- Events that don't specify a year group (whole school events)
- Events matching a child's year group or school
- General parent information (term dates, school closures)
- Payment requests that might apply to any child

`;
}
