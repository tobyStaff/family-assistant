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
 * @param fewShotSection - Optional few-shot examples section from user feedback
 * @returns The formatted prompt string
 */
export function buildEmailAnalysisPrompt(
  emails: EmailMetadata[],
  currentDate: Date,
  childProfiles: AnonymizedChildProfile[] = [],
  fewShotSection: string = ''
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

**Calendar/Diary Lists:**
When you encounter a "Term Diary", "Calendar", "Upcoming Dates", or similar list of dates:
- Extract dated items as separate events - do NOT summarize or skip items
- Process the ENTIRE list from start to finish - do NOT stop early
- Include ALL months mentioned (January through December if present)
- Special days (World Book Day, Science Week) → create event
- Competitions, sales, concerts → create event
- Term start/end dates, half-terms, inset days → create event
- Items coming home in book bags with return deadlines → create TODO with deadline
${childProfiles.length === 0 ? `
**NO CHILD PROFILES CONFIGURED - Extract Everything:**
Since no child profiles are set up, extract ALL events regardless of year group or class.
- Extract events for ALL year groups
- Include both specific events AND whole-school events
- The user will filter relevance later
` : `
**CHILD PROFILES ARE CONFIGURED - See filtering rules in CHILD PROFILES section below.**
Only extract events relevant to the configured children. Skip events for other year groups/classes.
`}

=== SECTION 3: TODO EXTRACTION ===

**Todo Type Classification:**
- **PAY**: Payment required for CONFIRMED commitment (extract amount and URL - see payment link rules below)
- **BUY**: Need to purchase from shop
- **PACK**: Need to pack/send item from home (item already exists, just needs packing)
- **SIGN**: Need to sign a document/form
- **FILL**: Need to complete a form/questionnaire
- **READ**: Need to read document/attachment
- **DECIDE**: Review an OPTIONAL opportunity that requires a decision (club sign-up, optional trip, etc.)
- **REMIND**: General reminder, repair tasks, fix tasks, or anything that doesn't fit above categories

**CRITICAL: Optional Opportunities vs Confirmed Commitments**

Before creating PAY todos or calendar events, determine if the item is:

**OPTIONAL (requires sign-up decision):**
Signal phrases:
- "We are pleased to offer..."
- "If you would like your child to..."
- "Places must be booked..."
- "If your child is interested..."
- "Sign up via..."
- "Booking required"
- "Limited places available"

→ Create ONE todo of type **DECIDE** with description like:
  "Consider [activity name] - £X, [key details], sign up by [deadline if known]"
→ Do NOT create PAY todos (parent hasn't decided yet)
→ Do NOT create calendar events (child not enrolled yet)

**CONFIRMED (already committed):**
Signal phrases:
- "Reminder: your child is attending..."
- "Payment is now due for [thing child is already signed up for]..."
- "Your child has been selected for..."
- Mandatory school events (trips, PE, assemblies)
- Things listed on the school calendar/term dates

→ Create PAY todos if payment required
→ Create calendar events for the dates

**Example - OPTIONAL after-school club offer:**
Email: "We are offering Boxercise Club, Thursdays 3:30-4:30pm, £40 for 5 sessions. Book via Arbor."

CORRECT:
- Todo: "Consider Boxercise Club sign-up (£40, 5 Thursdays from 26 Feb, book via Arbor)" type=DECIDE
- Events: NONE (child not enrolled)

WRONG:
- Todo: "Pay £40 for Boxercise" type=PAY ← assumes decision made
- Events: 5 calendar entries ← assumes child enrolled

**Example - CONFIRMED trip:**
Email: "Reminder: Year 5 trip to Winchester Science Centre. Payment of £15 due by Friday."

CORRECT:
- Todo: "Pay £15 for Winchester Science Centre trip" type=PAY (this is a reminder, child already going)
- Event: Winchester Science Centre trip

**Payment Link Detection (IMPORTANT for PAY type):**
When extracting payment todos, look carefully for actual payment provider URLs, NOT school website links.

Known UK school payment providers (prioritize these domains):
- **Arbor**: arbor-education.com, login.arbor.sc, *.arbor.sc
- **Scopay**: scopay.com
- **Classlist**: classlist.com
- **ParentPay**: parentpay.com
- **SchoolMoney**: schoolmoney.co.uk
- **ParentMail**: parentmail.co.uk
- **WisePay**: wisepay.co.uk
- **School Gateway**: schoolgateway.com
- **Tucasi**: tucasi.com
- **SIMS Pay**: simspay.co.uk
- **Pay360**: pay360.com

**Payment URL Rules:**
1. ONLY set the \`url\` field if you find an actual payment provider link (from the list above)
2. School website links (e.g., "www.myschool.sch.uk") are NOT payment links - do not use these
3. If the email mentions a payment provider by name but has no direct link, set \`url\` to null
4. Include the payment provider name in the description (e.g., "Pay £80 via Arbor for residential trip")
5. Generic "click here to pay" links to school websites should be ignored for the url field

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

**TODO CONSOLIDATION (avoid over-granularity):**
A single-topic email typically needs only ONE todo, even if it lists multiple preparation steps.

CONSOLIDATE into ONE todo when:
- Email has numbered/bulleted sub-steps for ONE task (e.g., "1. Choose theme 2. Gather materials 3. Bring to school")
- Steps are all part of preparing for the same event/activity
- Steps don't have different deadlines

CREATE SEPARATE todos when:
- Actions are genuinely DISTINCT (e.g., "Pay for trip" AND "Sign permission slip" = 2 todos)
- Actions have DIFFERENT deadlines
- Actions are different TYPES (e.g., PAY + PACK = 2 todos)

**Consolidation Example:**
Email: "For Animaltastic week, please: (i) help child choose animal theme (ii) gather research materials (iii) source materials for 3D model if making one"

CORRECT - ONE consolidated todo:
- "Prepare for Animaltastic week: help child choose theme and gather materials/resources" (type=REMIND)

WRONG - over-granular:
- "Help child decide on animal theme" ← these are all sub-steps
- "Gather information and resources" ← of the same task
- "Source materials for 3D model" ← don't create 3 separate todos

**Events vs Todos Rule:**
- Multiple DATES in one email → create multiple EVENTS (one per date) ✓
- Multiple STEPS for one task → create ONE consolidated TODO ✓

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

**Example 2: One-off Trip with Payment Link**
Email: "Year 3 trip to the Science Museum on Friday 24th January. Cost £12, payment due by 20th Jan. Pay here: https://www.parentpay.com/trip-123"

Analysis:
- Event: "Year 3 trip to Science Museum" on 2026-01-24T09:00:00 (morning, not recurring)
- Todo 1: "Pay £12 via ParentPay for Science Museum trip" due 2026-01-20T23:59:00 (PAY, url: "https://www.parentpay.com/trip-123", not recurring)
- Todo 2: "Pack lunch for Science Museum trip" due 2026-01-24T09:00:00 (PACK, inferred, not recurring)

**Example 2b: Payment Required but No Direct Link**
Email: "Reminder: £80 instalment for residential trip due Friday 23rd January. Payable via Arbor please. Kind regards, School Office. w: https://www.myschool.sch.uk"

Analysis:
- Todo: "Pay £80 via Arbor for residential trip instalment" due 2026-01-23T23:59:00 (PAY, url: null, amount: "£80.00")
- Note: The school website link is NOT a payment link - Arbor is mentioned but no arbor.sc URL is present, so url is null

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

**Example 5: OPTIONAL Club Sign-up Offer (IMPORTANT - do NOT create events or PAY todos)**
Email: "We are pleased to offer Boxercise Club for pupils. Thursdays 3:30-4:30pm starting 26th Feb for 5 weeks. Cost £40 total. Book via Arbor."

Analysis:
- Events: NONE (this is an OFFER - child is not enrolled yet)
- Todo: "Consider Boxercise Club sign-up (£40, 5 Thursdays from 26 Feb, book via Arbor)" type=DECIDE

Key points:
- "We are pleased to offer" = OPTIONAL opportunity, not confirmed
- Do NOT create PAY todo - parent hasn't decided to sign up yet
- Do NOT create 5 calendar events - child is not enrolled
- Create ONE DECIDE todo so parent can review the opportunity

**Example 6: CONFIRMED Trip (contrast with Example 5)**
Email: "Reminder: Your child is signed up for the Year 5 trip to Winchester. Payment of £15 due by Friday."

Analysis:
- Event: "Year 5 Trip to Winchester Science Centre" (date from context)
- Todo: "Pay £15 for Winchester trip" type=PAY

Key points:
- "Your child is signed up" = CONFIRMED commitment
- Create PAY todo because child is already going
- Create calendar event because it's happening

**Example 7: TODO CONSOLIDATION (single topic with multiple steps)**
Email: "Animaltastic Learning Week is Feb 9-12. Please: (i) help your child choose an animal theme (ii) help gather research materials (iii) if making a 3D model, source materials at home."

CORRECT Analysis:
- Event: "Animaltastic Learning Week" Feb 9-12 (one event for the date range)
- Todo: "Prepare for Animaltastic week: help child choose theme and gather research materials" type=REMIND (ONE consolidated todo)

WRONG Analysis (over-granular):
- Todo 1: "Help child decide on animal theme" ← NO
- Todo 2: "Gather information and resources" ← NO
- Todo 3: "Source materials for 3D model" ← NO
These are sub-steps of ONE preparation task, not 3 separate todos.

Key points:
- Single-topic email = typically ONE todo
- Numbered sub-steps (i, ii, iii) are part of the same task
- Consolidate into one actionable todo
- Multiple events only if multiple DATES

---
${fewShotSection}
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
${email.bodyText ? `\n\nFull Body:\n${email.bodyText.substring(0, 5000)}` : ''}
${email.attachmentContent ? `\n\n=== ATTACHMENT CONTENT ===\n${email.attachmentContent.substring(0, 8000)}` : ''}
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
=== CHILD PROFILES ===

The family has these children:
${profilesList}

**CRITICAL: You MUST filter out irrelevant events. Follow these steps IN ORDER:**

**Step 1: Identify the source school**
- Determine which school the email is from (sender address, letterhead, school name mentions)
- Match to children by their school_name field

**Step 2: FILTER FIRST - Remove irrelevant events BEFORE adding to output**
For EACH potential event/todo, check if it should be EXCLUDED:

DO NOT INCLUDE (skip entirely - do not add to events/todos arrays):
- Year-specific events when NO child is in that year
  **Year patterns to match:** "Year X", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7", "Y8", "Year R", "Reception"
  Examples of SKIPPING:
  - "Year 8 Parent Consultation Evening" when child is Year 7 → SKIP (wrong year)
  - "Y4 Residential to Sayers Croft" when child is Year 5 → SKIP (wrong year)
  - "Year 2 Swimming" when child is in Reception → SKIP (wrong year)
  - "Y1 Woodland School" when child is in Year 2 → SKIP (wrong year)
  - "Year 6 SATs prep" when child is in Year 5 → SKIP (wrong year)
- Class-specific events when NO child is in that class
  Example: "Elm Woodland School" when child has no class_name or different class → SKIP THIS EVENT
  Example: "Lime Woodland School", "Beech Woodland School", "Cherry Woodland School" → SKIP if child not in that class
- Club-specific events when NO child is in that club
  Example: "Rocksteady Concert" when child has no clubs or not in Rocksteady → SKIP THIS EVENT
- Events for different schools
  Example: "St Mary's trip" when children attend Milford → SKIP THIS EVENT

ALWAYS INCLUDE (add to output):
- Whole-school events (Inset Days, Half-terms, term start/end dates, World Book Day)
- Events matching child's year group (e.g., "Year R to Woodland School" for Reception child)
- Events matching child's class (if class_name is set)
- Events matching child's clubs (if clubs are set)
- Parent-focused events (Parents Evening, cake sales open to all)
- Payment deadlines and return-by dates (these affect all families)
- Ambiguous events - when unsure, INCLUDE

**Step 3: Assign child_name to ALL remaining events (IMPORTANT)**
After filtering, you MUST assign a child_name to every event/todo you include:

SINGLE CHILD AT THE SOURCE SCHOOL:
- Count how many children attend the school this email is from
- If only ONE child attends this school: set child_name to that child's ID for EVERY event/todo
- Do NOT use "General" when there's only one child - that child owns all events from their school
- Example: If only "${childIds.split(', ')[0] || 'CHILD_1'}" attends Milford, then ALL Milford events get child_name: "${childIds.split(', ')[0] || 'CHILD_1'}"

MULTIPLE CHILDREN AT SAME SCHOOL:
- Year-specific events → assign to the child in that year
- Class-specific events → assign to the child in that class
- Whole-school events → use "General" or list all children comma-separated

ALWAYS include school name in the location field.

**FILTERING EXAMPLES:**

**Example A - Child: Year 7 at Rodborough School:**
INCLUDE:
✓ "Year 7 Parent Consultation Evening" (matches year)
✓ "Y7&8 Girls Netball" (child is in Year 7)
✓ "Half Term" (whole school)
✓ "Inset Day" (whole school)
✓ "End of Term" (whole school)

EXCLUDE (wrong year - do NOT add):
✗ "Year 8 Parent Consultation Evening" (Year 8 ≠ Year 7)
✗ "Year 9 Parent Consultation Evening" (Year 9 ≠ Year 7)
✗ "Y8 Germany trip" (Year 8 ≠ Year 7)
✗ "Year 6 SATs" (Year 6 ≠ Year 7)

**Example B - Child: Year 5 at Busbridge Junior School:**
INCLUDE:
✓ "Year 5 Trip to Winchester Science Centre" (matches year)
✓ "5W Class Assembly" (Year 5)
✓ "Swimming Gala Years 4, 5 and 6" (child is Year 5)
✓ "Inset Day" (whole school)
✓ "Parents Evening" (all parents)

EXCLUDE (wrong year - do NOT add):
✗ "Y4 Residential to Sayers Croft" (Year 4 ≠ Year 5)
✗ "Year 3 Romans Day" (Year 3 ≠ Year 5)
✗ "Year 4 Vikings Day" (Year 4 ≠ Year 5)
✗ "3B Class Assembly" (Year 3 class)
✗ "4GT Class Assembly" (Year 4 class)

**Example C - Child: Reception (Year R) at Milford, no class set:**
INCLUDE:
✓ "Year R to Woodland School" (matches year)
✓ "Inset Day" (whole school)
✓ "Half-term" (whole school)
✓ "Parents Evening" (all parents)

EXCLUDE (wrong year/class - do NOT add):
✗ "Y1 Woodland School" (Year 1 ≠ Reception)
✗ "Year 2 Swimming" (Year 2 ≠ Reception)
✗ "Elm Woodland School" (class-specific, child has no class set)
✗ "Rocksteady Concert" (club-specific, child not in club)

`;
}
