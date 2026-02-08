// src/parsers/extractionSchema.ts

/**
 * OpenAI JSON Schema for event and todo extraction
 * Used with Structured Outputs for guaranteed valid JSON
 *
 * Updated for Task 1.9: Enhanced extraction with recurring flags and human analysis
 */
export const extractionSchema = {
  type: 'object',
  properties: {
    human_analysis: {
      type: 'object',
      description: 'Human-readable analysis of the email content',
      properties: {
        email_summary: {
          type: 'string',
          description: 'Brief summary of the email purpose (1-2 sentences)',
        },
        email_tone: {
          type: 'string',
          description: 'Tone of the email (e.g., informative, urgent, casual, formal)',
        },
        email_intent: {
          type: 'string',
          description: 'Primary intent (e.g., action required, information only, reminder)',
        },
        implicit_context: {
          type: 'string',
          description: 'Any implicit assumptions or shared context inferred from the email',
        },
      },
      required: ['email_summary', 'email_tone', 'email_intent', 'implicit_context'],
      additionalProperties: false,
    },
    events: {
      type: 'array',
      description: 'Key events extracted from emails (trips, inset days, performances, etc.)',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Event name (e.g., "Inset Day - No School", "Year 3 Trip to Museum")',
          },
          date: {
            type: 'string',
            description: 'ISO8601 datetime when event occurs (e.g., "2026-01-20T09:00:00Z")',
          },
          end_date: {
            type: 'string',
            description: 'ISO8601 datetime when event ends (optional, for multi-day events)',
          },
          description: {
            type: 'string',
            description: 'Additional context about the event',
          },
          location: {
            type: 'string',
            description: 'Event location if mentioned',
          },
          child_name: {
            type: 'string',
            description: 'Name of child this event is for, or "General" if family-wide',
          },
          source_email_id: {
            type: 'string',
            description: 'Email ID from processed_emails table (if available)',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score from 0.0 to 1.0',
            minimum: 0,
            maximum: 1,
          },
          recurring: {
            type: 'boolean',
            description: 'True if this is a recurring event (weekly, monthly, etc.)',
          },
          recurrence_pattern: {
            type: 'string',
            description: 'Recurrence pattern if recurring (e.g., "weekly on Mondays", "monthly first Tuesday")',
          },
          time_of_day: {
            type: 'string',
            enum: ['morning', 'afternoon', 'evening', 'all_day', 'specific'],
            description: 'Time of day category. Use "specific" if exact time is given.',
          },
          inferred_date: {
            type: 'boolean',
            description: 'True if the date/time was inferred rather than explicitly stated',
          },
        },
        required: ['title', 'date', 'end_date', 'description', 'location', 'child_name', 'source_email_id', 'confidence', 'recurring', 'recurrence_pattern', 'time_of_day', 'inferred_date'],
        additionalProperties: false,
      },
    },
    todos: {
      type: 'array',
      description: 'Action items that require parent attention',
      items: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'What needs to be done (e.g., "Pay £15 for school trip", "Pack PE kit")',
          },
          type: {
            type: 'string',
            enum: ['PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'DECIDE', 'REMIND'],
            description: 'Category: PAY=payment, BUY=purchase, PACK=pack item, SIGN=sign form, FILL=fill form, READ=read document, DECIDE=review optional opportunity, REMIND=general reminder',
          },
          due_date: {
            type: 'string',
            description: 'ISO8601 datetime when this is due (null if no deadline)',
          },
          child_name: {
            type: 'string',
            description: 'Name of child this is for, or "General" if family-wide',
          },
          source_email_id: {
            type: 'string',
            description: 'Email ID from processed_emails table (if available)',
          },
          url: {
            type: 'string',
            description: 'Payment link or relevant URL (especially for type=PAY)',
          },
          amount: {
            type: 'string',
            description: 'Amount for payments (e.g., "£15.00", "€20", "$25.50")',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score from 0.0 to 1.0',
            minimum: 0,
            maximum: 1,
          },
          recurring: {
            type: 'boolean',
            description: 'True if this is a recurring task (e.g., weekly PE kit)',
          },
          recurrence_pattern: {
            type: 'string',
            description: 'Recurrence pattern if recurring (e.g., "every Monday", "weekly")',
          },
          responsible_party: {
            type: 'string',
            description: 'Who is responsible for this task (e.g., "parent", "child", "both")',
          },
          inferred: {
            type: 'boolean',
            description: 'True if this action was inferred rather than explicitly stated',
          },
        },
        required: ['description', 'type', 'due_date', 'child_name', 'source_email_id', 'url', 'amount', 'confidence', 'recurring', 'recurrence_pattern', 'responsible_party', 'inferred'],
        additionalProperties: false,
      },
    },
    emails_analyzed: {
      type: 'integer',
      description: 'Number of emails analyzed',
    },
  },
  required: ['human_analysis', 'events', 'todos', 'emails_analyzed'],
  additionalProperties: false,
} as const;

/**
 * Type guard to validate extraction result
 */
export function isValidExtractionResult(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.events)) return false;
  if (!Array.isArray(data.todos)) return false;
  if (typeof data.emails_analyzed !== 'number') return false;

  // Validate human_analysis (optional for backward compatibility)
  if (data.human_analysis) {
    if (typeof data.human_analysis !== 'object') return false;
  }

  // Validate events
  for (const event of data.events) {
    if (!event.title || !event.date || typeof event.confidence !== 'number') {
      return false;
    }
  }

  // Validate todos
  for (const todo of data.todos) {
    if (!todo.description || !todo.type || typeof todo.confidence !== 'number') {
      return false;
    }
    const validTypes = ['PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'DECIDE', 'REMIND'];
    if (!validTypes.includes(todo.type)) {
      return false;
    }
  }

  return true;
}

/**
 * Type definitions for extraction result
 */
export interface HumanAnalysis {
  email_summary: string;
  email_tone: string;
  email_intent: string;
  implicit_context?: string;
}

export interface ExtractedEvent {
  title: string;
  date: string;
  end_date?: string;
  description?: string;
  location?: string;
  child_name: string;
  source_email_id?: string;
  confidence: number;
  recurring: boolean;
  recurrence_pattern?: string;
  time_of_day: 'morning' | 'afternoon' | 'evening' | 'all_day' | 'specific';
  inferred_date: boolean;
}

export interface ExtractedTodo {
  description: string;
  type: 'PAY' | 'BUY' | 'PACK' | 'SIGN' | 'FILL' | 'READ' | 'DECIDE' | 'REMIND';
  due_date?: string;
  child_name: string;
  source_email_id?: string;
  url?: string;
  amount?: string;
  confidence: number;
  recurring: boolean;
  recurrence_pattern?: string;
  responsible_party?: string;
  inferred: boolean;
}

export interface EnhancedExtractionResult {
  human_analysis: HumanAnalysis;
  events: ExtractedEvent[];
  todos: ExtractedTodo[];
  emails_analyzed: number;
  extraction_timestamp: string;
}
