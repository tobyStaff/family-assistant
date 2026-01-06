// src/parsers/aiParser.ts
import { OpenAI } from 'openai';
import { z } from 'zod';
import { IParser, ParsedSemantics } from './IParser.js';

// Output schema for Zod validation
const SemanticsSchema = z.object({
  importance: z.enum(['high', 'medium', 'low']),
  urgency: z.enum(['immediate', 'short-term', 'long-term']),
  actions: z.array(
    z.object({
      description: z.string(),
      dueDate: z.string().optional(), // ISO string, parse to Date later
    })
  ),
  dates: z.array(
    z.object({
      event: z.string(),
      start: z.string(), // ISO
      end: z.string().optional(),
      timezone: z.string().optional(),
    })
  ),
});

export class AiParser implements IParser {
  private provider: 'openai' | 'anthropic';
  private openai?: OpenAI;
  // private anthropic?: Anthropic; // Stub for future switch

  constructor() {
    this.provider = (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic';

    if (this.provider === 'openai') {
      const apiKey = process.env.AI_API_KEY;
      if (!apiKey) {
        throw new Error('AI_API_KEY environment variable is required when using OpenAI');
      }
      this.openai = new OpenAI({ apiKey });
    }
    // else if (this.provider === 'anthropic') { init Anthropic }
  }

  async parse(emailContent: string): Promise<ParsedSemantics | null> {
    if (this.provider !== 'openai') {
      throw new Error(`Provider '${this.provider}' not implemented yet`);
    }

    const prompt = `Analyze this email content: "${emailContent}"

Extract semantics:
- importance: high/medium/low (how important is this email overall?)
- urgency: immediate/short-term/long-term (how quickly does it need attention?)
- actions: array of {description: string, dueDate?: ISO date string} (actionable items mentioned)
- dates: array of {event: string, start: ISO date string, end?: ISO, timezone?: string} (calendar events or time-based items)

Respond ONLY with valid JSON matching this schema. No extra text or explanations.`;

    try {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2, // Low for determinism
      });

      const jsonStr = response.choices[0]?.message?.content?.trim() || '';

      if (!jsonStr) {
        console.error('AI parser: Empty response from OpenAI');
        return null;
      }

      // Parse JSON and validate with Zod
      let parsedJson;
      try {
        parsedJson = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('AI parser: Invalid JSON response:', jsonStr);
        return null;
      }

      const validated = SemanticsSchema.safeParse(parsedJson);

      if (!validated.success) {
        console.error('AI parser: Validation failed:', validated.error);
        return null;
      }

      // Convert ISO strings to Date objects
      return {
        ...validated.data,
        actions: validated.data.actions.map((a) => {
          const action: { description: string; dueDate?: Date } = {
            description: a.description,
          };
          if (a.dueDate) {
            action.dueDate = new Date(a.dueDate);
          }
          return action;
        }),
        dates: validated.data.dates.map((d) => {
          const date: { event: string; start: Date; end?: Date; timezone?: string } = {
            event: d.event,
            start: new Date(d.start),
          };
          if (d.end) {
            date.end = new Date(d.end);
          }
          if (d.timezone) {
            date.timezone = d.timezone;
          }
          return date;
        }),
      };
    } catch (error) {
      console.error('AI parser error:', error);
      return null;
    }
  }
}
