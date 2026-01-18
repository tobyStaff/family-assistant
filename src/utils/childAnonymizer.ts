// src/utils/childAnonymizer.ts
//
// Privacy layer for child profiles when sending data to AI.
// Replaces real child names with anonymized IDs (CHILD_1, CHILD_2, etc.)
// and maps them back after receiving AI responses.

import type { ChildProfile } from '../types/childProfile.js';

/**
 * Mapping between anonymized ID and real child data
 */
export interface ChildMapping {
  id: string;           // "CHILD_1", "CHILD_2", etc.
  real_name: string;    // Actual child name
  year_group: string;   // e.g., "7", "5"
  school_name: string;  // e.g., "Rodborough"
}

/**
 * Anonymized child profile for AI prompts
 */
export interface AnonymizedChildProfile {
  id: string;           // "CHILD_1"
  year_group: string;   // "7"
  school_name: string;  // "Rodborough"
}

/**
 * Create mappings from child profiles to anonymized IDs
 */
export function createChildMappings(profiles: ChildProfile[]): ChildMapping[] {
  return profiles.map((profile, index) => ({
    id: `CHILD_${index + 1}`,
    real_name: profile.real_name,
    year_group: profile.year_group || 'Unknown',
    school_name: profile.school_name || 'Unknown',
  }));
}

/**
 * Get anonymized profiles for AI prompt (no real names)
 */
export function getAnonymizedProfiles(mappings: ChildMapping[]): AnonymizedChildProfile[] {
  return mappings.map((m) => ({
    id: m.id,
    year_group: m.year_group,
    school_name: m.school_name,
  }));
}

/**
 * Anonymize text by replacing real child names with CHILD_X IDs
 * Case-insensitive replacement
 */
export function anonymizeText(text: string, mappings: ChildMapping[]): string {
  if (!text || mappings.length === 0) return text;

  let result = text;
  for (const mapping of mappings) {
    // Create case-insensitive regex for the real name
    // Escape special regex characters in the name
    const escapedName = mapping.real_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedName, 'gi');
    result = result.replace(regex, mapping.id);
  }
  return result;
}

/**
 * Deanonymize text by replacing CHILD_X IDs with real names
 */
export function deanonymizeText(text: string | null | undefined, mappings: ChildMapping[]): string | null | undefined {
  if (!text || mappings.length === 0) return text;

  let result = text;
  for (const mapping of mappings) {
    const regex = new RegExp(mapping.id, 'g');
    result = result.replace(regex, mapping.real_name);
  }
  return result;
}

/**
 * Deanonymize an extraction result (events, todos, human_analysis)
 * Replaces CHILD_X references with real names in all relevant fields
 */
export function deanonymizeExtractionResult(result: any, mappings: ChildMapping[]): any {
  if (!result || mappings.length === 0) return result;

  // Deep clone to avoid mutating original
  const cloned = JSON.parse(JSON.stringify(result));

  // Deanonymize human_analysis
  if (cloned.human_analysis) {
    cloned.human_analysis.email_summary = deanonymizeText(cloned.human_analysis.email_summary, mappings);
    cloned.human_analysis.implicit_context = deanonymizeText(cloned.human_analysis.implicit_context, mappings);
  }

  // Deanonymize events
  if (Array.isArray(cloned.events)) {
    for (const event of cloned.events) {
      event.title = deanonymizeText(event.title, mappings);
      event.description = deanonymizeText(event.description, mappings);
      event.child_name = deanonymizeText(event.child_name, mappings);
    }
  }

  // Deanonymize todos
  if (Array.isArray(cloned.todos)) {
    for (const todo of cloned.todos) {
      todo.description = deanonymizeText(todo.description, mappings);
      todo.child_name = deanonymizeText(todo.child_name, mappings);
    }
  }

  return cloned;
}

/**
 * Format anonymized profiles for the AI prompt
 */
export function formatProfilesForPrompt(profiles: AnonymizedChildProfile[]): string {
  if (profiles.length === 0) {
    return 'No child profiles configured.';
  }

  return profiles
    .map((p) => `- ${p.id}: Year ${p.year_group} at ${p.school_name}`)
    .join('\n');
}
