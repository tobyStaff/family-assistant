// src/utils/personalizedSummaryBuilder.ts

import { getUpcomingEvents as getUpcomingEventsFromDb, type Event } from '../db/eventDb.js';
import { getTodos } from '../db/todoDb.js';
import { getChildProfiles } from '../db/childProfilesDb.js';
import { getRecentlyAnalyzedCount } from '../db/emailAnalysisDb.js';
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
  highlight?: string; // AI-generated #1 thing to remember today
  emailsAnalyzed?: number; // Count of emails analyzed for this summary
}

export interface ChildSummary {
  child_name: string;
  display_name?: string; // Privacy alias if set
  today_todos: Todo[];
  today_events: ExtractedEvent[];
  upcoming_todos: Todo[]; // Tomorrow onwards
  upcoming_events: ExtractedEvent[]; // Tomorrow onwards
  insights: string[];
}

export interface FamilySummary {
  today_todos: Todo[];
  today_events: ExtractedEvent[];
  upcoming_todos: Todo[]; // Tomorrow onwards
  upcoming_events: ExtractedEvent[]; // Tomorrow onwards
  insights: string[];
}

/**
 * Extended event type that includes the database id
 */
export interface ExtractedEventWithId extends ExtractedEvent {
  id: number;
}

/**
 * Convert database event to extracted event format (includes id for action links)
 */
function dbEventToExtracted(event: Event): ExtractedEventWithId {
  return {
    id: event.id,
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
 * Split items into today and upcoming (tomorrow onwards)
 * Past non-recurring items are filtered out (they should have been cleaned up)
 */
function splitByDay<T extends { date?: string; due_date?: Date; recurring?: boolean }>(
  items: T[],
  dateField: 'date' | 'due_date'
): { today: T[]; upcoming: T[] } {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const today: T[] = [];
  const upcoming: T[] = [];

  for (const item of items) {
    const itemDate = dateField === 'date'
      ? (item.date ? new Date(item.date) : null)
      : (item.due_date || null);

    if (!itemDate) {
      upcoming.push(item); // No date = upcoming/for consideration
      continue;
    }

    // Items from today
    if (itemDate >= todayStart && itemDate < tomorrowStart) {
      today.push(item);
    } else if (itemDate < todayStart) {
      // Past items: only include if recurring (one-off past items are filtered out)
      if (item.recurring) {
        today.push(item);
      }
      // Non-recurring past items are silently dropped - cleanup should handle them
    } else {
      upcoming.push(item);
    }
  }

  return { today, upcoming };
}

/**
 * Generate AI insights using structured data
 *
 * Uses OpenAI to analyze organized events/todos and provide helpful insights
 * Also generates a highlight - the single most important thing to remember today
 */
async function generateAIInsights(
  childSummaries: ChildSummary[],
  familySummary: FamilySummary,
  childProfiles: ChildProfile[]
): Promise<{ childInsights: Map<string, string[]>; familyInsights: string[]; highlight: string | null }> {
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
      today_todos_count: s.today_todos.length,
      today_todos_types: s.today_todos.map(t => t.type),
      today_events_count: s.today_events.length,
      upcoming_todos_count: s.upcoming_todos.length,
      upcoming_events_count: s.upcoming_events.length,
    })),
    family_wide: {
      today_todos_count: familySummary.today_todos.length,
      today_events_count: familySummary.today_events.length,
    },
  };

  // Build detailed today items for highlight selection
  const todayDetails = {
    events: [
      ...childSummaries.flatMap(s => s.today_events.map(e => ({
        title: e.title,
        child: s.child_name,
        time: e.date
      }))),
      ...familySummary.today_events.map(e => ({
        title: e.title,
        child: 'Family',
        time: e.date
      }))
    ],
    todos: [
      ...childSummaries.flatMap(s => s.today_todos.map(t => ({
        description: t.description,
        type: t.type,
        child: s.child_name
      }))),
      ...familySummary.today_todos.map(t => ({
        description: t.description,
        type: t.type,
        child: 'Family'
      }))
    ]
  };

  const prompt = `You are an elite Executive Assistant for busy parents with school-age children.

You have access to organized data about the family's upcoming schedule:

**Children**:
${context.children.map(c => `- ${c.name} (Year ${c.year_group}, ${c.school})`).join('\n')}

**Today's Items**:
${childSummaries.map(s => `
${s.child_name}:
- ${s.today_todos.length} todos today (types: ${s.today_todos.map(t => t.type).join(', ')})
- ${s.today_events.length} events today
`).join('\n')}

Family-wide:
- ${familySummary.today_todos.length} todos today
- ${familySummary.today_events.length} events today

**Today's Events Detail**:
${todayDetails.events.map(e => `- [${e.child}] ${e.title}`).join('\n') || 'No events today'}

**Today's Todos Detail**:
${todayDetails.todos.map(t => `- [${t.child}] ${t.type}: ${t.description}`).join('\n') || 'No todos today'}

**Upcoming This Week**:
${childSummaries.map(s => `
${s.child_name}: ${s.upcoming_todos.length} todos, ${s.upcoming_events.length} events
`).join('\n')}

Your task:
1. **HIGHLIGHT**: Identify the SINGLE most important thing to remember TODAY. This should be:
   - Something happening TODAY (not upcoming)
   - Preferably something that requires action or could be easily forgotten
   - Examples: "Mufti day today!", "Swimming kit needed", "School trip - packed lunch required"
   - If nothing urgent, pick the most notable event/todo for today
   - Keep it SHORT (under 10 words if possible)
   - If absolutely nothing is happening today, return null

2. For each child, provide 1-2 helpful insights:
   - "Leo has PE tomorrow - remember to pack kit"
   - "Payment deadline for Ella's trip is Friday"
   - "Busy week ahead for Max: 3 events"

3. Provide 1-2 family-wide insights:
   - "Busy Tuesday: overlapping events for both children"
   - "3 payments due this week totaling £45"

4. Keep insights brief, actionable, and empathetic
5. Use display names if provided (for privacy)

Return JSON:
{
  "highlight": "Mufti day today!" or null if nothing today,
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
      highlight: parsed.highlight || null,
    };
  } catch (error: any) {
    console.error('Error generating AI insights:', error);
    // Return empty insights on error
    return {
      childInsights: new Map(),
      familyInsights: [],
      highlight: null,
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
    const { today: todayTodos, upcoming: upcomingTodos } = splitByDay(data.todos, 'due_date');
    const { today: todayEvents, upcoming: upcomingEvents } = splitByDay(data.events, 'date');

    childSummaries.push({
      child_name: profile.real_name,
      display_name: profile.display_name || undefined,
      today_todos: todayTodos,
      today_events: todayEvents,
      upcoming_todos: upcomingTodos,
      upcoming_events: upcomingEvents,
      insights: [], // Will be filled by AI
    });
  }

  // Step 4: Build family-wide summary
  const { today: todayFamilyTodos, upcoming: upcomingFamilyTodos } = splitByDay(organized.familyWide.todos, 'due_date');
  const { today: todayFamilyEvents, upcoming: upcomingFamilyEvents } = splitByDay(organized.familyWide.events, 'date');

  const familySummary: FamilySummary = {
    today_todos: todayFamilyTodos,
    today_events: todayFamilyEvents,
    upcoming_todos: upcomingFamilyTodos,
    upcoming_events: upcomingFamilyEvents,
    insights: [], // Will be filled by AI
  };

  // Step 5: Generate AI insights (includes highlight)
  const { childInsights, familyInsights, highlight } = await generateAIInsights(
    childSummaries,
    familySummary,
    childProfiles
  );

  // Add insights to summaries
  for (const summary of childSummaries) {
    summary.insights = childInsights.get(summary.child_name) || [];
  }
  familySummary.insights = familyInsights;

  // Step 6: Generate fallback highlight if AI didn't provide one
  let finalHighlight = highlight;
  if (!finalHighlight) {
    // Fallback: use first today event or todo
    const firstTodayEvent = childSummaries.find(s => s.today_events.length > 0)?.today_events[0]
      || familySummary.today_events[0];
    const firstTodayTodo = childSummaries.find(s => s.today_todos.length > 0)?.today_todos[0]
      || familySummary.today_todos[0];

    if (firstTodayEvent) {
      finalHighlight = firstTodayEvent.title;
    } else if (firstTodayTodo) {
      finalHighlight = firstTodayTodo.description;
    }
  }

  // Step 7: Get emails analyzed count (last 48 hours)
  const emailsAnalyzed = getRecentlyAnalyzedCount(userId, 48);

  // Step 8: Return complete summary
  return {
    generated_at: now,
    date_range: { start: now, end: futureDate },
    by_child: childSummaries,
    family_wide: familySummary,
    insights: familyInsights, // Top-level insights
    highlight: finalHighlight || undefined,
    emailsAnalyzed: emailsAnalyzed > 0 ? emailsAnalyzed : undefined,
  };
}
