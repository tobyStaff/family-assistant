// src/parsers/IParser.ts
export interface IParser {
  parse(emailContent: string): ParsedResult | Promise<ParsedResult | null> | null;
}

// Union type for all parse results (NLP or AI)
export type ParsedResult = ParsedCommand | ParsedSemantics;

// NLP parser result (from Deliverable 3)
export interface ParsedCommand {
  type: 'todo' | 'task' | 'cal'; // Based on keyword
  description: string;
  dueDate?: Date; // Optional, parsed via chrono
  // Add more fields as needed, e.g., priority if keywords expand
}

// AI parser result (from Deliverable 4)
export interface ParsedSemantics {
  importance: 'high' | 'medium' | 'low';
  urgency: 'immediate' | 'short-term' | 'long-term';
  actions: Array<{ description: string; dueDate?: Date }>;
  dates: Array<{ event: string; start: Date; end?: Date; timezone?: string }>;
}
