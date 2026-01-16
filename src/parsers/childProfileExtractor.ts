// src/parsers/childProfileExtractor.ts

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { EmailMetadata } from '../types/summary.js';
import type {
  ExtractedChildInfo,
  OnboardingAnalysisResult,
} from '../types/childProfile.js';

/**
 * Lazy-load OpenAI client (only when needed)
 */
function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Lazy-load Anthropic client (only when needed)
 */
function getAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * OpenAI JSON Schema for child profile extraction
 */
const childProfileExtractionSchema = {
  type: 'object',
  properties: {
    children: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Child name as mentioned in emails',
          },
          year_group: {
            type: 'string',
            description:
              'School year/grade (e.g., "Year 3", "Reception", "Year 1"). Empty string if not mentioned.',
          },
          school_name: {
            type: 'string',
            description:
              'School name if mentioned. Empty string if not mentioned.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score from 0.0 to 1.0',
            minimum: 0,
            maximum: 1,
          },
          example_emails: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Array of email subjects where this child was mentioned (max 3)',
          },
        },
        required: ['name', 'year_group', 'school_name', 'confidence', 'example_emails'],
        additionalProperties: false,
      },
      description: 'List of children detected from school emails',
    },
    schools_detected: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'All unique school names mentioned across emails',
    },
  },
  required: ['children', 'schools_detected'],
  additionalProperties: false,
} as const;

/**
 * Generate AI prompt for child profile extraction
 */
function generateExtractionPrompt(emails: EmailMetadata[]): string {
  const emailSummaries = emails
    .map(
      (email, index) =>
        `[${index + 1}] From: ${email.fromName} <${email.from}>
Subject: ${email.subject}
Snippet: ${email.snippet}
`
    )
    .join('\n');

  return `You are analyzing school-related emails to extract information about children and schools.

Your task is to identify:
1. **Children's names** mentioned in the emails
2. **Year groups** (e.g., "Year 3", "Reception", "Year 1", "Nursery")
3. **School names**
4. **Confidence** in the extraction (0.0 to 1.0)

**IMPORTANT RULES:**

1. **Child Name Detection:**
   - Look for specific child names mentioned in email subjects and snippets
   - Common patterns: "Ella's class", "for Leo", "Dear parents of Ella"
   - DO NOT extract: teacher names, class names without specific children, generic references
   - Each child should be mentioned in at least 2 different emails to be confident

2. **Year Group Detection:**
   - Extract explicit year groups: "Year 3", "Year 1", "Reception", "Nursery"
   - Format consistently: "Year X" (not "Yr X" or "year x")
   - If not mentioned, use empty string ""

3. **School Name Detection:**
   - Look for school names in sender domains, signatures, or email content
   - Extract full school name (e.g., "St Mary's Primary School")
   - If not mentioned, use empty string ""

4. **Confidence Scoring:**
   - 0.9-1.0: Child mentioned explicitly in 3+ emails with year group
   - 0.7-0.9: Child mentioned in 2+ emails
   - 0.5-0.7: Child mentioned in 1 email clearly
   - Below 0.5: Ambiguous or uncertain

5. **Example Emails:**
   - Include up to 3 email subjects where the child was mentioned
   - Use actual email subjects from the input

**Emails to analyze:**

${emailSummaries}

**Output Format:**
- Return a JSON object with:
  - "children": array of detected children (name, year_group, school_name, confidence, example_emails)
  - "schools_detected": array of all unique school names found

**Empty string rule:**
- If year_group is unknown: ""
- If school_name is unknown: ""
- NEVER use null or undefined
`;
}

/**
 * Extract child profile information from emails using AI
 *
 * @param emails - Array of email metadata to analyze
 * @param provider - AI provider to use ('openai' or 'anthropic')
 * @returns Extracted child information
 */
export async function extractChildProfiles(
  emails: EmailMetadata[],
  provider: 'openai' | 'anthropic' = 'openai'
): Promise<OnboardingAnalysisResult> {
  const prompt = generateExtractionPrompt(emails);

  if (provider === 'openai') {
    console.log('🔍 Analyzing emails with OpenAI for child profile extraction...');

    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-2024-08-06',
      messages: [
        {
          role: 'system',
          content:
            'You are an AI assistant that analyzes school-related emails to extract information about children and schools. Be precise and conservative in your extractions.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'child_profile_extraction',
          strict: true,
          schema: childProfileExtractionSchema,
        },
      },
      temperature: 0.3, // Lower temperature for more consistent extraction
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content);

    // Calculate date range
    const dates = emails.map((e) => new Date(e.receivedAt).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    return {
      children: parsed.children,
      schools_detected: parsed.schools_detected,
      email_count_analyzed: emails.length,
      date_range: {
        from: minDate.toISOString(),
        to: maxDate.toISOString(),
      },
    };
  } else {
    // Anthropic implementation
    console.log('🔍 Analyzing emails with Anthropic for child profile extraction...');

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      system:
        'You are an AI assistant that analyzes school-related emails to extract information about children and schools. Be precise and conservative in your extractions. Always respond with valid JSON.',
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

    const parsed = JSON.parse(content.text);

    // Calculate date range
    const dates = emails.map((e) => new Date(e.receivedAt).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    return {
      children: parsed.children,
      schools_detected: parsed.schools_detected,
      email_count_analyzed: emails.length,
      date_range: {
        from: minDate.toISOString(),
        to: maxDate.toISOString(),
      },
    };
  }
}
