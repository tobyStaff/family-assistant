// src/utils/personalizedSummaryBuilder.ts

import { getUpcomingEvents as getUpcomingEventsFromDb, type Event } from '../db/eventDb.js';
import { getTodos } from '../db/todoDb.js';
import { getChildProfiles } from '../db/childProfilesDb.js';
import type { Todo } from '../types/todo.js';
import type { ChildProfile } from '../types/childProfile.js';
import type { ExtractedEvent } from '../types/extraction.js';

/**
 * Personalized summary structure organized by child
 */
export interface PersonalizedSummary {
  generated_at: Date;
  date_range: { start: Date; end: Date };
  by_child: ChildSummary[];
  family_wide: FamilySummary;
  insights: string[];
}

export interface ChildSummary {
  child_name: string;
  display_name?: string; // Privacy alias if set
  urgent_todos: Todo[];
  upcoming_todos: Todo[];
  urgent_events: ExtractedEvent[];
  upcoming_events: ExtractedEvent[];
  insights: string[];
}

export interface FamilySummary {
  urgent_todos: Todo[];
  upcoming_todos: Todo[];
  urgent_events: ExtractedEvent[];
  upcoming_events: ExtractedEvent[];
  insights: string[];
}

/**
 * Convert database event to extracted event format
 */
function dbEventToExtracted(event: Event): ExtractedEvent {
  return {
    title: event.title,
    date: event.date.toISOString(),
    end_date: event.end_date?.toISOString(),
    description: event.description,
    location: event.location,
    child_name: event.child_name || 'General',
    source_email_id: event.source_email_id,
    confidence: event.confidence || 1.0,
  };
}

/**
 * Organize events and todos by child
 */
function organizeByChild(
  dbEvents: Event[],
  todos: Todo[],
  childProfiles: ChildProfile[]
): { byChild: Map<string, { events: ExtractedEvent[]; todos: Todo[] }>; familyWide: { events: ExtractedEvent[]; todos: Todo[] } } {
  const byChild = new Map<string, { events: ExtractedEvent[]; todos: Todo[] }>();
  const familyWide = { events: [] as ExtractedEvent[], todos: [] as Todo[] };

  // Initialize map for each child
  for (const profile of childProfiles) {
    byChild.set(profile.real_name, { events: [], todos: [] });
  }

  // Convert and organize database events by child
  for (const dbEvent of dbEvents) {
    const event = dbEventToExtracted(dbEvent);
    if (dbEvent.child_name && dbEvent.child_name !== 'General' && byChild.has(dbEvent.child_name)) {
      byChild.get(dbEvent.child_name)!.events.push(event);
    } else {
      familyWide.events.push(event);
    }
  }

  // Organize todos
  for (const todo of todos) {
    if (todo.child_name && todo.child_name !== 'General' && byChild.has(todo.child_name)) {
      byChild.get(todo.child_name)!.todos.push(todo);
    } else {
      familyWide.todos.push(todo);
    }
  }

  return { byChild, familyWide };
}

/**
 * Split items into urgent (today/tomorrow) and upcoming (rest of week)
 */
function splitByUrgency<T extends { date?: string; due_date?: Date }>(
  items: T[],
  dateField: 'date' | 'due_date'
): { urgent: T[]; upcoming: T[] } {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 2);
  tomorrow.setHours(0, 0, 0, 0);

  const urgent: T[] = [];
  const upcoming: T[] = [];

  for (const item of items) {
    const itemDate = dateField === 'date'
      ? (item.date ? new Date(item.date) : null)
      : (item.due_date || null);

    if (!itemDate) {
      upcoming.push(item);
      continue;
    }

    if (itemDate < tomorrow) {
      urgent.push(item);
    } else {
      upcoming.push(item);
    }
  }

  return { urgent, upcoming };
}

/**
 * Generate AI insights using structured data
 *
 * Uses OpenAI to analyze organized events/todos and provide helpful insights
 */
async function generateAIInsights(
  childSummaries: ChildSummary[],
  familySummary: FamilySummary,
  childProfiles: ChildProfile[]
): Promise<{ childInsights: Map<string, string[]>; familyInsights: string[] }> {
  // Lazy-load OpenAI to avoid loading env vars too early
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Build context for AI
  const context = {
    date: new Date().toISOString().split('T')[0],
    children: childProfiles.map(p => ({
      name: p.real_name,
      year_group: p.year_group,
      school: p.school_name,
      display_name: p.display_name,
    })),
    by_child: childSummaries.map(s => ({
      child_name: s.child_name,
      urgent_todos_count: s.urgent_todos.length,
      urgent_todos_types: s.urgent_todos.map(t => t.type),
      urgent_events_count: s.urgent_events.length,
      upcoming_todos_count: s.upcoming_todos.length,
      upcoming_events_count: s.upcoming_events.length,
    })),
    family_wide: {
      urgent_todos_count: familySummary.urgent_todos.length,
      urgent_events_count: familySummary.urgent_events.length,
    },
  };

  const prompt = `You are an elite Executive Assistant for busy parents with school-age children.

You have access to organized data about the family's upcoming schedule:

**Children**:
${context.children.map(c => `- ${c.name} (Year ${c.year_group}, ${c.school})`).join('\n')}

**Urgent Items (Today/Tomorrow)**:
${childSummaries.map(s => `
${s.child_name}:
- ${s.urgent_todos.length} urgent todos (types: ${s.urgent_todos.map(t => t.type).join(', ')})
- ${s.urgent_events.length} urgent events
`).join('\n')}

Family-wide:
- ${familySummary.urgent_todos.length} urgent todos
- ${familySummary.urgent_events.length} urgent events

**Upcoming This Week**:
${childSummaries.map(s => `
${s.child_name}: ${s.upcoming_todos.length} todos, ${s.upcoming_events.length} events
`).join('\n')}

Your task:
1. For each child, provide 1-2 helpful insights:
   - "Leo has PE tomorrow - remember to pack kit"
   - "Payment deadline for Ella's trip is Friday"
   - "Busy week ahead for Max: 3 events"
2. Provide 1-2 family-wide insights:
   - "Busy Tuesday: overlapping events for both children"
   - "3 payments due this week totaling £45"
3. Keep insights brief, actionable, and empathetic
4. Use display names if provided (for privacy)

Return JSON:
{
  "child_insights": {
    "Ella": ["insight 1", "insight 2"],
    "Leo": ["insight 1"]
  },
  "family_insights": ["insight 1", "insight 2"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(content);
    return {
      childInsights: new Map(Object.entries(parsed.child_insights || {})) as Map<string, string[]>,
      familyInsights: parsed.family_insights || [],
    };
  } catch (error: any) {
    console.error('Error generating AI insights:', error);
    // Return empty insights on error
    return {
      childInsights: new Map(),
      familyInsights: [],
    };
  }
}

/**
 * Generate personalized email briefing using stored data
 *
 * This pipeline uses stored events and todos from the database
 * (populated by AI analysis) instead of calling external APIs.
 *
 * @param userId - User ID
 * @param daysAhead - How many days to look ahead (default: 7)
 * @returns Personalized summary
 */
export async function generatePersonalizedSummary(
  userId: string,
  daysAhead: number = 7
): Promise<PersonalizedSummary> {
  // Step 1: Gather structured data from database
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  // Get events and todos from database (populated by AI analysis)
  const dbEvents = getUpcomingEventsFromDb(userId, daysAhead);
  const pendingTodos = getTodos(userId, { status: 'pending' });
  const childProfiles = await getChildProfiles(userId, true); // active only

  // Step 2: Organize by child
  const organized = organizeByChild(dbEvents, pendingTodos, childProfiles);

  // Step 3: Build child summaries
  const childSummaries: ChildSummary[] = [];
  for (const profile of childProfiles) {
    const data = organized.byChild.get(profile.real_name) || { events: [], todos: [] };
    const { urgent: urgentTodos, upcoming: upcomingTodos } = splitByUrgency(data.todos, 'due_date');
    const { urgent: urgentEvents, upcoming: upcomingEvents } = splitByUrgency(data.events, 'date');

    childSummaries.push({
      child_name: profile.real_name,
      display_name: profile.display_name || undefined,
      urgent_todos: urgentTodos,
      upcoming_todos: upcomingTodos,
      urgent_events: urgentEvents,
      upcoming_events: upcomingEvents,
      insights: [], // Will be filled by AI
    });
  }

  // Step 4: Build family-wide summary
  const { urgent: urgentFamilyTodos, upcoming: upcomingFamilyTodos } = splitByUrgency(organized.familyWide.todos, 'due_date');
  const { urgent: urgentFamilyEvents, upcoming: upcomingFamilyEvents } = splitByUrgency(organized.familyWide.events, 'date');

  const familySummary: FamilySummary = {
    urgent_todos: urgentFamilyTodos,
    upcoming_todos: upcomingFamilyTodos,
    urgent_events: urgentFamilyEvents,
    upcoming_events: upcomingFamilyEvents,
    insights: [], // Will be filled by AI
  };

  // Step 5: Generate AI insights
  const { childInsights, familyInsights } = await generateAIInsights(
    childSummaries,
    familySummary,
    childProfiles
  );

  // Add insights to summaries
  for (const summary of childSummaries) {
    summary.insights = childInsights.get(summary.child_name) || [];
  }
  familySummary.insights = familyInsights;

  // Step 6: Return complete summary
  return {
    generated_at: now,
    date_range: { start: now, end: futureDate },
    by_child: childSummaries,
    family_wide: familySummary,
    insights: familyInsights, // Top-level insights
  };
}
