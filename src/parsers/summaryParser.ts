// src/parsers/summaryParser.ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { InboxAnalysisInput, SchoolSummary } from '../types/summary.js';
import { schoolSummarySchema } from './schoolSummarySchema.js';

/**
 * AI provider type
 */
export type AIProvider = 'openai' | 'anthropic';

/**
 * Build the AI prompt for inbox analysis
 */
function buildPrompt(input: InboxAnalysisInput): string {
  return `Role: You are an elite Executive Assistant for high-performance parents. Your job is to extract Signal from Noise.

**CRITICAL RULE - Email Count:**
You will receive EXACTLY ${input.emailCount} emails in the input data below.
You MUST report: email_analysis.total_received = ${input.emailCount}
Do NOT make up data. Do NOT assume data you didn't receive.
If signal_count + noise_count ≠ ${input.emailCount}, your response is INVALID.

**CRITICAL RULE - Signal Classification:**
School-related emails MUST be classified as SIGNAL, not NOISE.
Examples of SIGNAL emails (school-related):
- "Ella PE Days this term" → SIGNAL (PE schedule)
- "PE Kit required tomorrow" → SIGNAL (equipment needed)
- "Class trip to museum" → SIGNAL (school event)
- "Homework due Friday" → SIGNAL (academic)
- "Parent evening next week" → SIGNAL (school event)
Examples of NOISE emails (non-school):
- "20% off book sale" → NOISE (commercial marketing)
- "Parenting tips newsletter" → NOISE (general content, no school connection)
If an email mentions school activities, logistics, or comes from school staff → ALWAYS SIGNAL.

**Context:**
- Date: ${input.date}
- Total emails: ${input.emailCount}
- Upcoming TODOs: ${input.upcomingTodos.length}
- Upcoming calendar events: ${input.upcomingEvents.length}

**Input:**
- Raw email data from Gmail (emails only - no WhatsApp or other sources)

**Reasoning Steps (Chain-of-Thought):**
1. Identity: Extract child names ONLY if explicitly mentioned in the emails. If no child names found, use "General" for the child field.
2. Attachment Priority Check:
   - If email has attachments AND is from a school/education sender, classify as SIGNAL
   - School senders include: school domains, teachers, parent groups, education platforms
   - Attachments from schools are important even with minimal body text
3. Signal Filter: Classify remaining emails as either:
   - **SIGNAL** (School-Related): ANY email about:
     * Schedules (PE days, class times, term dates, timetables)
     * Events (trips, performances, parent evenings, sports day, assemblies)
     * Logistics (uniform, kit, equipment, lunch, pickup/dropoff)
     * Payments (school trips, activities, meals, clubs)
     * Academic (homework, projects, assessments, reports)
     * Behavior/attendance (absence, sick days, conduct)
     * Communications from: teachers, school office, head teacher, class teachers, PTA
     * Keywords indicating SIGNAL: PE, uniform, kit, trip, payment, homework, class, term, assembly, club
   - **NOISE** (Non-School): ONLY emails that are:
     * Commercial marketing (sales, promotions, advertisements)
     * Newsletters with no actionable school content
     * General parenting tips/articles with no school connection
     * Spam or unrelated services
   - **CRITICAL**: When in doubt, classify as SIGNAL. It's better to include a school email than miss it.
4. **ATTACHMENT CONTENT PROCESSING** (CRITICAL):
   - Look for sections marked "=== IMPORTANT: ATTACHMENT CONTENT BELOW ==="
   - This is extracted text from PDF/DOCX attachments - treat it as HIGH PRIORITY
   - Extract ALL key information from attachment content:
     * **Dates & Deadlines**: Add to calendar_updates with ISO8601 format
     * **Payment Requests**: Add to financials with exact amount and deadline
     * **Kit Requirements**: Add to kit_list if mentioned
     * **Action Items**: Summarize in 1 line in summary section (e.g., "Permission form requires signature by Friday")
     * **Forms/Consent**: If attachment mentions forms, consent, or signatures → add to attachments_requiring_review
   - Even if email body is minimal, the attachment content is the main message
5. **RECURRING PATTERN DETECTION** (NEW):
   - Look for phrases indicating recurring activities:
     * "PE on Monday and Tuesday", "PE days are Monday and Wednesday"
     * "every Monday", "every Tuesday and Thursday"
     * "Swimming club every Thursday"
     * "[Child name]: PE days on..."
   - Extract to recurring_activities array:
     * description: Activity name (e.g., "PE", "Swimming club", "Forest School")
     * child: Child's name (extract from email context)
     * days_of_week: Array of numbers (1=Monday, 2=Tuesday, ..., 7=Sunday)
     * frequency: "weekly" (only weekly supported for now)
     * requires_kit: true if activity needs equipment/kit
     * kit_items: Array of items if mentioned, or empty array [] if not mentioned
   - Examples:
     * "Ella: PE days on Monday and Tuesday this term" →
       {description: "PE", child: "Ella", days_of_week: [1, 2], frequency: "weekly", requires_kit: true, kit_items: ["PE kit"]}
     * "Leo has swimming every Thursday after school" →
       {description: "Swimming", child: "Leo", days_of_week: [4], frequency: "weekly", requires_kit: true, kit_items: ["Swimming kit", "towel"]}
     * "Forest School on Fridays" (no kit mentioned) →
       {description: "Forest School", child: "General", days_of_week: [5], frequency: "weekly", requires_kit: false, kit_items: []}
   - If NO recurring patterns detected → recurring_activities: []
6. Logistics Extraction: Look for dates, times, kit requirements (PE, Art), and payment links in both email body and attachments.
7. Payment Method Detection: Identify payment platforms (Arbor Pay, Classlist, ParentPay, etc.) and extract payment URLs.

**Output Format:**
Return ONLY a valid JSON object following this schema:
{
  "email_analysis": {
    "total_received": number,
    "signal_count": number,
    "noise_count": number,
    "noise_examples": ["string (subject of noise email)", ...]
  },
  "summary": [
    {
      "child": "string (child's name from email, or 'General' if no specific child mentioned)",
      "icon": "string (emoji)",
      "text": "string (summary of what needs attention)"
    }
  ],
  "kit_list": {
    "tomorrow": [
      {
        "item": "string (e.g., 'PE kit')",
        "context": "string (e.g., '[Child Name] - outdoor PE' or 'General - outdoor PE')"
      }
    ],
    "upcoming": [
      {
        "item": "string (e.g., 'Art apron')",
        "day": "string (e.g., 'Thursday')"
      }
    ]
  },
  "financials": [
    {
      "description": "string (e.g., 'School trip payment')",
      "amount": "string (e.g., '£15.00')",
      "deadline": "string (ISO8601 date REQUIRED - e.g., '2026-01-15T00:00:00Z')",
      "url": "string (payment link or 'manual_check_required')",
      "payment_method": "string (e.g., 'Arbor Pay', 'Classlist', 'ParentPay', 'Cash', 'Cheque', 'Bank Transfer', 'Check email for details', or empty if not specified)"
    }
  ],
  "attachments_requiring_review": [
    {
      "subject": "string (email subject)",
      "from": "string (sender name)",
      "reason": "string (e.g., 'Contains PDF attachment with minimal body text')"
    }
  ],
  "calendar_updates": [
    {
      "event": "string (e.g., 'Inset Day - no school')",
      "date": "string (ISO8601)",
      "action": "string (added or updated)"
    }
  ],
  "pro_dad_insight": "string (one actionable insight or tip for the day)"
}

**Strict Instructions:**
- CRITICAL: Count ALL emails received in email_analysis.total_received (must equal ${input.emailCount})
- Track signal_count (school-related emails) vs noise_count (non-school emails)
- Include up to 5 noise_examples (subjects of filtered emails) for transparency
- **ATTACHMENT HANDLING RULES** (CRITICAL):
  * ALWAYS classify as SIGNAL if from a school/education sender with attachments
  * When you see "=== IMPORTANT: ATTACHMENT CONTENT BELOW ===" in email body:
    - This is extracted PDF/DOCX text - contains the MAIN information
    - Extract dates, payments, and action items from this section
    - Summarize key info in 1 line in summary section
    - If attachment mentions forms/signatures/consent → add to attachments_requiring_review
  * **Informational attachments**: Summarize in 1 concise line (e.g., "School calendar for Spring term attached")
  * **Action items in attachments**: Extract to proper sections:
    - Dates/events → calendar_updates (ISO8601 format required)
    - Payment amounts → financials (with deadline as ISO8601)
    - Forms requiring signature → attachments_requiring_review with clear reason
  * Example: If attachment says "Trip to museum on Jan 20th, £15 due by Jan 17th, return consent form"
    → Add to financials, calendar_updates, attachments_requiring_review, AND summary
- **CRITICAL FINANCIAL ITEM RULES**:
  * deadline field MUST be a valid ISO8601 date (e.g., "2026-01-15T00:00:00Z") - NO EXCEPTIONS
  * If NO deadline date is mentioned in the email → EXCLUDE that financial item entirely from financials array
  * ❌ FORBIDDEN: NEVER put text strings in deadline field ("Check email for details", "TBC", "See email", etc.)
  * ❌ If you see a payment WITHOUT a specific deadline date → DO NOT add it to financials
  * ✅ ONLY add financial items when you have BOTH: specific amount AND specific deadline date
  * For payment_method field (NOT deadline!):
    - "Arbor Pay" → include url: https://login.arbor.sc/
    - "Classlist" → include url: https://app.classlist.com/
    - "ParentPay" → include url: https://www.parentpay.com/
    - If payment mentioned but method unclear → set payment_method to "Check email for details" (payment_method only, never deadline!)
- Only surface signals that require action or awareness
- Do NOT make up data. Only analyze the emails provided in the input.

**CRITICAL: DO NOT INVENT CHILD NAMES:**
- ONLY use child names that are explicitly mentioned in the emails
- DO NOT use example names from this prompt (like "Leo", "Maya", etc.)
- If no child names are mentioned in emails, use "General" for the child field
- Extract names EXACTLY as they appear in emails (e.g., if email says "Year 3 students", use "Year 3")

**STRICT EMPTY VALUE RULES (Do NOT invent data):**
- If NO financial items found → financials: []
- If NO kit needed tomorrow → kit_list.tomorrow: []
- If NO upcoming kit needed → kit_list.upcoming: []
- If NO attachments requiring review → attachments_requiring_review: []
- If NO calendar updates → calendar_updates: []
- If NO recurring activities detected → recurring_activities: []
- If NO noise examples → noise_examples: []
- If NO summary items → summary: [{"child": "General", "icon": "✅", "text": "No school emails requiring attention"}]
- NEVER return null or undefined for any field
- NEVER invent items that don't exist in the emails

**EXAMPLE - GOOD OUTPUT:**
// NOTE: Names like "Leo" below are EXAMPLE PLACEHOLDERS ONLY
// In your actual response, use REAL child names from the emails, or "General" if none mentioned
// Input: 5 emails received (4 signal, 1 noise)
// One email has PDF attachment with trip details extracted
{
  "email_analysis": {
    "total_received": 5,        // ✅ Matches input
    "signal_count": 4,          // ✅ Includes PE email, attachment email, etc
    "noise_count": 1,           // ✅ Adds up: 4 + 1 = 5
    "noise_examples": ["Book Sale - 20% Off Children's Books"]  // ✅ Commercial marketing = noise
  },
  "summary": [
    {"child": "Leo", "icon": "🏛️", "text": "Science Museum trip on Jan 20th - payment and consent form required by Friday"},  // ✅ Extracted from attachment
    {"child": "Leo", "icon": "⚽", "text": "PE tomorrow - outdoor session"}
  ],
  "kit_list": {
    "tomorrow": [{"item": "PE kit", "context": "Leo - outdoor PE"}],
    "upcoming": []
  },
  "financials": [
    {
      "description": "School trip to Science Museum",
      "amount": "£12.50",
      "deadline": "2026-01-17T00:00:00Z",  // ✅ Extracted from attachment PDF
      "url": "https://login.arbor.sc/",
      "payment_method": "Arbor Pay"
    }
  ],
  "attachments_requiring_review": [
    {
      "subject": "School Trip - Science Museum",
      "from": "St. Mary's School",
      "reason": "Permission form requires parent signature by Jan 17th"  // ✅ Clear, specific reason from attachment
    }
  ],
  "calendar_updates": [
    {
      "event": "Science Museum school trip",
      "date": "2026-01-20T09:00:00Z",  // ✅ Extracted from attachment
      "action": "added"
    }
  ],
  "pro_dad_insight": "Complete trip permission form and payment by Friday to secure Leo's spot"
}

**EXAMPLE - BAD OUTPUT (DO NOT DO THIS):**
// NOTE: "Leo" is just an example name - use REAL names from emails or "General"
// Input: 5 emails received (including PE email and attachment)
{
  "email_analysis": {
    "total_received": 5,        // ✅ Matches input
    "signal_count": 2,          // ❌ WRONG - Missing PE email and attachment email
    "noise_count": 3,           // ❌ WRONG - Classified PE email as noise!
    "noise_examples": ["Ella PE Days this term", "Newsletter - January updates"]  // ❌ CRITICAL ERROR: PE email is SIGNAL not noise!
  },
  "summary": [
    {"child": "Leo", "icon": "⚽", "text": "PE tomorrow"},
    {"child": "Leo", "icon": "📎", "text": "Attachment received"}  // ❌ Too vague - should extract actual info from attachment
  ],
  "kit_list": {
    "tomorrow": [{"item": "Swimming kit", "context": "Leo - swimming"}],  // ❌ Invented data
    "upcoming": null  // ❌ Should be empty array []
  },
  "financials": [
    {
      "description": "Payment required",
      "amount": "TBC",  // ❌ Should have extracted £12.50 from attachment
      "deadline": "Check email for details",  // ❌ CRITICAL ERROR - deadline MUST be ISO8601 date or EXCLUDE the item entirely
      "url": "manual_check_required",
      "payment_method": "Friday"  // ❌ WRONG - this should be payment method, not deadline
    }
  ],
  // ❌ CORRECT APPROACH: If no deadline mentioned, return empty array: "financials": []
  "attachments_requiring_review": [
    {
      "subject": "School Trip",
      "from": "St. Mary's School",
      "reason": "Has attachment"  // ❌ Too vague - should say WHAT needs to be done
    }
  ],
  "calendar_updates": [],  // ❌ Should have extracted Jan 20th trip date from attachment
  "pro_dad_insight": ""  // ❌ Should have meaningful text
}

**Input Data:**

${JSON.stringify(input, null, 2)}

Return ONLY the JSON response, no additional text.`;
}

/**
 * Analyze inbox using OpenAI
 */
async function analyzeWithOpenAI(input: InboxAnalysisInput): Promise<SchoolSummary> {
  // Check for OpenAI-specific key first, fallback to general AI_API_KEY
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY or AI_API_KEY environment variable is required');
  }

  const openai = new OpenAI({ apiKey });

  const prompt = buildPrompt(input);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are an executive assistant that analyzes emails and returns structured JSON summaries.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 2500,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'school_summary',
        strict: true,
        schema: schoolSummarySchema
      }
    }
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  // With structured outputs (strict schema), the response is guaranteed to match our schema
  // No need to clean markdown blocks - OpenAI will return pure JSON
  try {
    const summary = JSON.parse(content) as SchoolSummary;

    // Log if schema validation is being used
    console.log('✅ OpenAI structured output received (schema-validated)');

    return summary;
  } catch (error) {
    // This should rarely happen with structured outputs
    console.error('❌ Failed to parse OpenAI response despite schema validation');
    console.error('Raw response:', content);
    console.error('Parse error:', error);
    throw new Error(`Invalid JSON response from OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Analyze inbox using Anthropic Claude
 */
async function analyzeWithAnthropic(input: InboxAnalysisInput): Promise<SchoolSummary> {
  // Check for Anthropic-specific key first, fallback to general AI_API_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or AI_API_KEY environment variable is required');
  }

  const anthropic = new Anthropic({ apiKey });

  const prompt = buildPrompt(input);

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2500,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  // Parse JSON response
  try {
    // Sometimes AI adds markdown code blocks - strip them
    let cleanedContent = content.text.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const summary = JSON.parse(cleanedContent) as SchoolSummary;
    return summary;
  } catch (error) {
    console.error('Failed to parse Anthropic response. Raw response:', content.text);
    console.error('Parse error:', error);
    throw new Error(`Invalid JSON response from Anthropic: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Analyze inbox with AI to generate structured summary
 *
 * @param input - Prepared inbox data
 * @param provider - AI provider to use ('openai' or 'anthropic')
 * @returns Structured school summary
 */
export async function analyzeInbox(
  input: InboxAnalysisInput,
  provider: AIProvider = 'openai'
): Promise<SchoolSummary> {
  if (provider === 'openai') {
    return analyzeWithOpenAI(input);
  } else {
    return analyzeWithAnthropic(input);
  }
}
