// src/parsers/nlpParser.ts
import * as chrono from 'chrono-node';
import { z } from 'zod';
import { IParser, ParsedCommand } from './IParser.js';

// Config schema for validation
const KeywordsSchema = z.object({
  todo: z.array(z.string()).min(1),
  task: z.array(z.string()).min(1),
  cal: z.array(z.string()).min(1),
}).strict();

// Export type for use in other modules
export type KeywordsConfig = z.infer<typeof KeywordsSchema>;

// Partial schema for constructor input validation
const PartialKeywordsSchema = z
  .object({
    todo: z.array(z.string()).min(1).optional(),
    task: z.array(z.string()).min(1).optional(),
    cal: z.array(z.string()).min(1).optional(),
  })
  .strict();

// Default configurable keywords
const DEFAULT_KEYWORDS: KeywordsConfig = {
  todo: ['#todo', '#to-do', '#addtodo'],
  task: ['#task', '#addtask'],
  cal: ['#cal', '#event', '#addevent'],
};

export class NlpParser implements IParser {
  private keywords: z.infer<typeof KeywordsSchema>;

  constructor(keywords?: Partial<z.infer<typeof KeywordsSchema>>) {
    // Validate input first if provided
    if (keywords) {
      PartialKeywordsSchema.parse(keywords);
    }

    // Merge with defaults and validate final result
    this.keywords = KeywordsSchema.parse({ ...DEFAULT_KEYWORDS, ...keywords });
  }

  parse(emailContent: string): ParsedCommand | null {
    const lowerContent = emailContent.toLowerCase();

    // Find first matching keyword and type
    let matchedType: ParsedCommand['type'] | null = null;
    let keyword: string | null = null;
    for (const [type, kwList] of Object.entries(this.keywords) as [ParsedCommand['type'], string[]][]) {
      for (const kw of kwList) {
        if (lowerContent.includes(kw.toLowerCase())) {
          matchedType = type;
          keyword = kw;
          break;
        }
      }
      if (matchedType) break;
    }

    if (!matchedType || !keyword) return null;

    // Extract description: text after the keyword (simple split, trim)
    const parts = emailContent.split(new RegExp(keyword, 'i')); // Case-insensitive split
    const description = (parts[1] || '').trim();

    // Parse date from description using chrono-node
    const parsedDates = chrono.parse(description);
    const dueDate = parsedDates.length > 0 ? parsedDates[0]?.start.date() : undefined;

    return {
      type: matchedType,
      description,
      ...(dueDate && { dueDate })
    };
  }
}

// Export defaults for use in router
export { DEFAULT_KEYWORDS };
