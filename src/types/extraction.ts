// src/types/extraction.ts

/**
 * Action item type categories
 */
export type TodoType =
  | 'PAY' // Payment required (e.g., trip fee, lunch money)
  | 'BUY' // Purchase item (e.g., uniform, supplies)
  | 'PACK' // Pack item for school (e.g., PE kit, costume)
  | 'SIGN' // Sign document/form
  | 'FILL' // Fill out form/questionnaire
  | 'READ' // Read attachment/document
  | 'REMIND'; // General reminder (default)

/**
 * Time of day category for events
 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'all_day' | 'specific';

/**
 * Extracted event from emails
 */
export interface ExtractedEvent {
  title: string; // Event name (e.g., "Inset Day - No School")
  date: string; // ISO8601 date (e.g., "2026-01-20T09:00:00Z")
  end_date?: string; // Optional end date for multi-day events
  description?: string; // Additional context
  location?: string; // Event location if mentioned
  child_name?: string; // Associated child (null = General)
  source_email_id?: string; // Email ID from processed_emails table
  confidence: number; // 0.0-1.0 confidence score
  // Enhanced fields (Task 1.9)
  recurring?: boolean; // True if recurring event
  recurrence_pattern?: string; // E.g., "weekly on Tuesdays"
  time_of_day?: TimeOfDay; // Time category
  inferred_date?: boolean; // True if date was inferred
}

/**
 * Extracted action item (todo) from emails
 */
export interface ExtractedTodo {
  description: string; // What needs to be done
  type: TodoType; // Category of action
  due_date?: string; // ISO8601 date (null if no deadline)
  child_name?: string; // Associated child (null = General)
  source_email_id?: string; // Email ID from processed_emails table
  url?: string; // Payment link or relevant URL
  amount?: string; // Amount if type=PAY (e.g., "£15.00")
  confidence: number; // 0.0-1.0 confidence score
  // Enhanced fields (Task 1.9)
  recurring?: boolean; // True if recurring task
  recurrence_pattern?: string; // E.g., "every Monday"
  responsible_party?: string; // "parent", "child", or "both"
  inferred?: boolean; // True if action was inferred
}

/**
 * Human-readable analysis of emails (Task 1.9)
 */
export interface HumanAnalysis {
  email_summary: string;
  email_tone: string;
  email_intent: string;
  implicit_context?: string;
}

/**
 * Result from AI extraction
 */
export interface ExtractionResult {
  events: ExtractedEvent[];
  todos: ExtractedTodo[];
  emails_analyzed: number;
  extraction_timestamp: string;
  // Enhanced field (Task 1.9)
  human_analysis?: HumanAnalysis;
}

/**
 * Type guard for TodoType
 */
export function isTodoType(value: string): value is TodoType {
  return ['PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND'].includes(value);
}

/**
 * Get emoji for todo type
 */
export function getTodoTypeEmoji(type: TodoType): string {
  const emojiMap: Record<TodoType, string> = {
    PAY: '💰',
    BUY: '🛍️',
    PACK: '🎒',
    SIGN: '✍️',
    FILL: '📝',
    READ: '📖',
    REMIND: '⏰',
  };
  return emojiMap[type];
}

/**
 * Get human-readable label for todo type
 */
export function getTodoTypeLabel(type: TodoType): string {
  const labelMap: Record<TodoType, string> = {
    PAY: 'Payment',
    BUY: 'Purchase',
    PACK: 'Pack Item',
    SIGN: 'Sign Form',
    FILL: 'Fill Form',
    READ: 'Read Document',
    REMIND: 'Reminder',
  };
  return labelMap[type];
}
