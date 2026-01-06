### Detailed Implementation for Deliverable 4: Modular Email Parser (AI Mode for Content)

As the lead web engineer, let's expand on Deliverable 4. This builds the AI-driven parser for unstructured email content, extracting semantics like importance, urgency, actions, and dates when no explicit commands are detected (via the router from Deliverable 8). It's the primary mode for general emails, using OpenAI's gpt-3.5-turbo for cost efficiency, but with ENV-based switchability (e.g., to Anthropic Claude) to avoid vendor lock-in. We'll keep it modular, implementing the same IParser interface from Deliverable 3 for seamless routing. TypeScript remains our core, as it ensures type-safe prompts and outputs without overhead. If we needed advanced NLP preprocessing (e.g., tokenization), I'd recommend a Python microservice with Hugging Face, but that's unnecessary here—OpenAI handles it end-to-end with minimal LOC.

Before implementation, let's assess 2-3 options for the AI parser structure, focusing on trade-offs:

1. **Option A: Direct SDK Integration in a Class (Chosen in Plan)**  
   - Build a TS class implementing IParser, using the OpenAI SDK to call chat.completions.create with a engineered prompt for JSON output. Parse response with Zod for validation. Use process.env.AI_PROVIDER for simple if/else switching (e.g., to Anthropic SDK). Limit tokens via max_tokens.  
   - Pros: Low LOC (~80-120 lines), direct control over prompts/costs, easy to test with mocks. Fully TS-native, no extra deps beyond SDKs.  
   - Cons: Switching providers requires code changes (though minimal), and error handling (e.g., rate limits) adds a bit of boilerplate.  
   - Trade-off: Balances simplicity and flexibility for MVP—1 day effort, minimal bugs. Ideal since AI is I/O-bound, not compute-heavy.

2. **Option B: Abstracted AI Client with Adapters**  
   - Create an abstract AIClient interface with adapters for OpenAI/Anthropic (e.g., OpenAIAdapter, AnthropicAdapter). The parser class injects the client based on ENV. Use a unified prompt format.  
   - Pros: True switchability without if/else sprawl; easier to add providers later (e.g., Grok). Better for long-term maintainability.  
   - Cons: Adds ~50-100 LOC for abstractions, increases complexity for MVP (e.g., mapping response formats). Slight perf overhead from indirection.  
   - Trade-off: Great for scalability, but overengineers for our 2-week cap and low-maintenance goal. We'd risk scope creep—skip unless provider switching is imminent.

3. **Option C: Serverless AI via Vercel AI SDK**  
   - Use @vercel/ai for a unified API across providers, handling streaming/errors natively. Integrate in the parser class.  
   - Pros: Reduces boilerplate for auth/retries, supports streaming for future UX (e.g., real-time parsing). Provider-agnostic out-of-box.  
   - Cons: Adds a dependency (~1MB), ties us to Vercel ecosystem slightly, and unnecessary if not deploying there. Not as lightweight as direct SDKs on our Digital Ocean setup.  
   - Trade-off: Enhances developer experience but bloats the minimal codebase. Not worth it for this backend-focused MVP—stick to core SDKs.

**Decision**: Proceed with Option A—direct SDK in a TS class. It keeps LOC minimal while meeting the plan's ENV switchability (via simple conditionals). This ensures determinism via JSON prompts and Zod, aligning with the hybrid router's need for speed/accuracy. We can refactor to adapters if needed post-MVP. Focus on OpenAI for now, with a stub for Anthropic.

Now, the implementation. Key files/snippets: Update IParser for AI output, the AI parser class, prompt engineering, integration with router, and tests (Jest). Place in `src/parsers/aiParser.ts`. Install: `npm i openai zod`. For Anthropic, conditionally `npm i @anthropic-ai/sdk`.

#### 1. Update the Interface (for AI-Specific Output)
Extend `src/parsers/IParser.ts` to support AI's richer semantics. (Reuse for polymorphism in router.)

```typescript
// src/parsers/IParser.ts (updated)
export interface IParser {
  parse(emailContent: string): ParsedResult | null; // Unified result type
}

export type ParsedResult = ParsedCommand | ParsedSemantics; // Union for NLP/AI

// From Deliverable 3
export interface ParsedCommand { /* ... */ }

// New for AI
export interface ParsedSemantics {
  importance: 'high' | 'medium' | 'low';
  urgency: 'immediate' | 'short-term' | 'long-term';
  actions: Array<{ description: string; dueDate?: Date }>;
  dates: Array<{ event: string; start: Date; end?: Date; timezone?: string }>;
}
```

#### 2. Implement the AI Parser Class
Engineered prompt forces JSON output. Use Zod schema for validation. ENV: AI_PROVIDER='openai' (default), AI_API_KEY. Token limit: 500 for cost (~$0.001/request).

```typescript
// src/parsers/aiParser.ts
import { OpenAI } from 'openai';
import { z } from 'zod';
import { IParser, ParsedSemantics } from './IParser';

// Output schema for Zod validation
const SemanticsSchema = z.object({
  importance: z.enum(['high', 'medium', 'low']),
  urgency: z.enum(['immediate', 'short-term', 'long-term']),
  actions: z.array(z.object({
    description: z.string(),
    dueDate: z.string().optional(), // ISO string, parse to Date later
  })),
  dates: z.array(z.object({
    event: z.string(),
    start: z.string(), // ISO
    end: z.string().optional(),
    timezone: z.string().optional(),
  })),
});

export class AiParser implements IParser {
  private provider: 'openai' | 'anthropic';
  private openai?: OpenAI;
  // private anthropic?: Anthropic; // Stub for switch

  constructor() {
    this.provider = (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic';
    if (this.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
    } // else if (this.provider === 'anthropic') { init Anthropic }
  }

  async parse(emailContent: string): Promise<ParsedSemantics | null> {
    if (this.provider !== 'openai') throw new Error('Provider not implemented'); // Stub

    const prompt = `
      Analyze this email content: "${emailContent}"
      Extract semantics:
      - importance: high/medium/low
      - urgency: immediate/short-term/long-term
      - actions: array of {description: string, dueDate?: ISO date string}
      - dates: array of {event: string, start: ISO date string, end?: ISO, timezone?: string}
      Respond ONLY with valid JSON matching this schema. No extra text.
    `;

    try {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2, // Low for determinism
      });

      const jsonStr = response.choices[0].message.content?.trim() || '';
      const parsed = SemanticsSchema.safeParse(JSON.parse(jsonStr));

      if (!parsed.success) return null; // Or throw/log error

      // Convert strings to Dates
      return {
        ...parsed.data,
        actions: parsed.data.actions.map(a => ({ ...a, dueDate: a.dueDate ? new Date(a.dueDate) : undefined })),
        dates: parsed.data.dates.map(d => ({
          ...d,
          start: new Date(d.start),
          end: d.end ? new Date(d.end) : undefined,
        })),
      };
    } catch (error) {
      console.error('AI parse error:', error);
      return null;
    }
  }
}
```

- **Notes**: 
  - Prompt is dense/self-contained for reliability. Forces JSON to avoid parsing hacks.
  - Async for API call—router will await.
  - Cost control: max_tokens limits spend; monitor via OpenAI dashboard.
  - Timezones: AI infers if mentioned; default to UTC later (per plan).
  - For Anthropic: Replace with client.messages.create, adapt prompt.

#### 3. Integration Snippet (for Router in Deliverable 8)
Reuse hasCommandKeywords from Deliverable 3.

```typescript
// Snippet for router logic (e.g., src/router/parserRouter.ts)
import { NlpParser } from './nlpParser';
import { AiParser } from './aiParser';

async function parseEmail(content: string) {
  if (hasCommandKeywords(content, DEFAULT_KEYWORDS)) {
    return new NlpParser().parse(content);
  } else {
    return await new AiParser().parse(content);
  }
}
```

#### 4. Testing Approach (Expanded)
`src/parsers/aiParser.test.ts`. Mock OpenAI with jest.mock('openai').

```typescript
// src/parsers/aiParser.test.ts
import { AiParser } from './aiParser';
import { OpenAI } from 'openai';

jest.mock('openai');

describe('AiParser', () => {
  beforeEach(() => {
    (OpenAI as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ /* valid mock data */ }) } }],
          }),
        },
      },
    }));
  });

  it('extracts semantics from unstructured content', async () => {
    const result = await new AiParser().parse('Urgent meeting tomorrow at 10am PST about project deadline.');
    expect(result).toMatchObject({
      importance: 'high',
      urgency: 'immediate',
      // etc., assert structure
    });
  });

  it('returns null on invalid JSON', async () => {
    // Mock invalid response
    expect(await new AiParser().parse('Bad input')).toBeNull();
  });

  it('validates with Zod', () => {
    // Test schema directly if needed
  });

  // More: Test token limits (mock large content), provider switch error, date parsing to Date objs
});
```

This completes Deliverable 4—compact, testable (~100 LOC core + tests). Integrates smoothly with the router for optimal parsing. If AI costs spike, we can tweak prompts or switch providers via ENV. On to Deliverable 5 if ready.