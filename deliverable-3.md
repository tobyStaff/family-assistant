### Detailed Implementation for Deliverable 3: Modular Email Parser (NLP Mode for Commands)

As the lead web engineer, let's zoom in on Deliverable 3. This module focuses on the NLP side of parsing, specifically for emails with explicit commands (e.g., those containing keywords like "#todo"). It's designed to be deterministic and fast, routing via a keyword scan to invoke NLP only when needed. We're keeping it modular to integrate with the router in Deliverable 8 and the AI mode in Deliverable 4. Since the overall app is in TypeScript with Fastify, we'll stick to TS here for type safety and minimalism. No need for other languages like Python (e.g., for NLTK)—chrono-node handles date parsing elegantly in Node.js.

Before coding, let's evaluate 2-3 options for structuring this parser, as good engineering weighs trade-offs:

1. **Option A: Simple Class-Based Parser (Chosen in Plan)**  
   - Implement as a TS class with methods for keyword matching and date extraction. Use an array for configurable keywords, scanned via string includes/regex for flexibility. Integrate chrono-node directly in the parse method.  
   - Pros: Minimal LOC (~50-100 lines), easy to test/unit mock, straightforward integration with the router (just instantiate and call). Keeps everything in TS.  
   - Cons: Less extensible if we add more NLP features later (e.g., sentiment); might need refactoring for advanced parsing.  
   - Trade-off: Perfect for MVP—fast to build (1 day), low bug surface. Prioritizes simplicity over future-proofing.

2. **Option B: Functional Pipeline with Lodash/Fp-ts**  
   - Use pure functions composed in a pipeline: scanKeywords() -> extractDates() -> validateOutput(). Leverage fp-ts for error handling/monads to make it more robust.  
   - Pros: Immutable, easier to reason about for complex flows; better for functional purists and scales to more parsers.  
   - Cons: Adds dependencies (fp-ts bloats node_modules slightly), increases LOC by 20-30% for the same functionality, overkill for this deterministic task.  
   - Trade-off: Great for maintainability in larger apps, but we'd exceed minimalism here. Skip for MVP to keep effort low.

3. **Option C: Integrate a Full NLP Lib like compromise**  
   - Use compromise (a lightweight JS NLP lib) for keyword matching, entity extraction, and dates, instead of just chrono-node + custom keywords.  
   - Pros: Handles more natural variations (e.g., "add task" without exact "#todo"), reduces custom code.  
   - Cons: Adds ~1MB dependency, less deterministic (ML-based fuzziness), potential perf hit on micro-VM. Deviates from plan's "strict keyword matching."  
   - Trade-off: Enhances accuracy for fuzzy commands but complicates the router (blurs NLP vs. AI lines). Not worth it for MVP—stick to explicit commands.

**Decision**: Go with Option A—a simple class-based parser in TS. It aligns with the plan's emphasis on determinism, configurability, and low LOC. We can always extend it later. This keeps the module portable and testable, integrating seamlessly with the IParser interface mentioned in the plan.

Now, let's flesh it out with code. I'll provide key files/snippets: the parser class, interface, config/validation with Zod, and unit tests (using Jest, assuming `npm i -D jest ts-jest @types/jest`). Structure: Place this in `src/parsers/nlpParser.ts`. The router (in Deliverable 8) will import this and call `parse()` if keywords match.

#### 1. Define the Interface (for Modularity)
We'll create `src/parsers/IParser.ts` to standardize parsers (NLP and AI will implement this).

```typescript
// src/parsers/IParser.ts
export interface IParser {
  parse(emailContent: string): ParsedCommand | null;
}

export interface ParsedCommand {
  type: 'todo' | 'task' | 'cal'; // Based on keyword
  description: string;
  dueDate?: Date; // Optional, parsed via chrono
  // Add more fields as needed, e.g., priority if keywords expand
}
```

#### 2. Implement the NLP Parser Class
Use a configurable keyword map (object for better type safety over array). Scan content case-insensitively. If a keyword matches, extract the command (e.g., text after "#todo"). Use chrono-node for dates in the description.

First, install deps: `npm i chrono-node zod`.

```typescript
// src/parsers/nlpParser.ts
import { parseDate } from 'chrono-node';
import { z } from 'zod';
import { IParser, ParsedCommand } from './IParser';

// Config schema for validation
const KeywordsSchema = z.object({
  todo: z.array(z.string()),
  task: z.array(z.string()),
  cal: z.array(z.string()),
});

// Default configurable keywords
const DEFAULT_KEYWORDS = {
  todo: ['#todo', '#to-do', '#addtodo'],
  task: ['#task', '#addtask'],
  cal: ['#cal', '#event', '#addevent'],
} as const; // For type inference

export class NlpParser implements IParser {
  private keywords: z.infer<typeof KeywordsSchema>;

  constructor(keywords?: Partial<z.infer<typeof KeywordsSchema>>) {
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

    // Parse date from description
    const parsedDates = parseDate(description);
    const dueDate = parsedDates.length > 0 ? parsedDates[0].start.date() : undefined;

    return { type: matchedType, description, dueDate };
  }
}
```

- **Notes**: 
  - Keyword scan is O(n) but negligible for email lengths.
  - Description extraction assumes command is "keyword + text"—refine if needed (e.g., handle multiple).
  - Chrono-node handles relatives like "next Tuesday @5pm" out-of-box.
  - Zod validates keywords at init for safety.

#### 3. Integration Snippet (for Router in Deliverable 8)
In the router (e.g., `src/router/parserRouter.ts`), scan for any keyword first, then route to this if match.

```typescript
// Snippet for router logic
function hasCommandKeywords(content: string, keywords: typeof DEFAULT_KEYWORDS): boolean {
  const lowerContent = content.toLowerCase();
  return Object.values(keywords).flat().some(kw => lowerContent.includes(kw.toLowerCase()));
}

// Usage: if (hasCommandKeywords(emailContent, DEFAULT_KEYWORDS)) { nlpParser.parse(...) } else { aiParser.parse(...) }
```

#### 4. Testing Approach (Expanded)
Use Jest for units. Create `src/parsers/nlpParser.test.ts`. Run `npx jest`.

```typescript
// src/parsers/nlpParser.test.ts
import { NlpParser } from './nlpParser';

describe('NlpParser', () => {
  const parser = new NlpParser();

  it('parses todo with relative date', () => {
    const result = parser.parse('Subject: #todo Buy milk tomorrow at 3pm');
    expect(result).toEqual({
      type: 'todo',
      description: 'Buy milk tomorrow at 3pm',
      dueDate: expect.any(Date), // Check actual date in test if needed
    });
  });

  it('ignores non-command emails', () => {
    expect(parser.parse('Just a regular email')).toBeNull();
  });

  it('handles custom keywords', () => {
    const customParser = new NlpParser({ todo: ['!todo'] });
    const result = customParser.parse('!todo Meeting next Tuesday');
    expect(result?.type).toBe('todo');
  });

  it('validates keywords with Zod', () => {
    expect(() => new NlpParser({ invalid: [] })).toThrow(); // Zod error
  });

  // More: Test various chrono formats like "in 2 days", "2026-01-06", edge cases (no date, multiple dates—take first)
});
```

This fleshes out Deliverable 3 fully—ready for a mid/senior dev or AI to implement/test. Total LOC: ~80 (core + tests), keeping it minimal. If issues arise (e.g., chrono missing timezones), we can pipe to date-fns-tz as in the plan. Next up, we can tackle Deliverable 4 if needed.