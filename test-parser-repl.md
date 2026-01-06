# Interactive REPL Testing

Run this in your terminal:

```bash
pnpm tsx
```

Then paste this code:

```typescript
import { NlpParser } from './src/parsers/nlpParser.js';
import { hasCommandKeywords } from './src/parsers/parserRouter.js';

const parser = new NlpParser();

// Try your own examples!
parser.parse('#todo Buy milk tomorrow')
parser.parse('#task Meeting next Friday at 2pm')
parser.parse('Regular email with no commands')

// Check if email has command keywords
hasCommandKeywords('#todo something')
hasCommandKeywords('just a regular email')

// Try custom keywords
const customParser = new NlpParser({ todo: ['!!action'] });
customParser.parse('!!action Do this now')
```

Press Ctrl+D to exit when done.
