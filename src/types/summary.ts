// src/types/summary.ts

/**
 * User settings for daily summary emails
 */
export interface UserSettings {
  user_id: string;
  summary_email_recipients: string[]; // Array of email addresses
  summary_enabled: boolean;
  summary_time_utc: number; // Hour in UTC (0-23)
  timezone: string;
  created_at?: Date | undefined;
  updated_at?: Date | undefined;
}

/**
 * Email summary record (stored in database)
 */
export interface EmailSummaryRecord {
  id?: number | undefined;
  user_id: string;
  summary_date: Date;
  inbox_count: number;
  summary_json: string; // Serialized InboxSummary
  sent_at?: Date | undefined;
}

/**
 * Email metadata for AI processing
 */
export interface EmailMetadata {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  receivedAt: string; // ISO 8601
  labels: string[];
  hasAttachments: boolean;
  bodyText?: string;
  attachmentContent?: string;
}

/**
 * Input data sent to AI for analysis
 */
export interface InboxAnalysisInput {
  date: string;
  emailCount: number;
  emails: EmailMetadata[];
  upcomingTodos: {
    description: string;
    dueDate?: string | undefined;
  }[];
  upcomingEvents: {
    summary: string;
    start: string;
  }[];
}

/**
 * Email item in AI output
 */
export interface SummaryEmailItem {
  from: string;
  subject: string;
  summary: string;
  actionNeeded?: string | undefined;
  deadline?: string | undefined;
}

/**
 * Email category in AI output
 */
export interface EmailCategory {
  name: string;
  priority: 'high' | 'medium' | 'low';
  count: number;
  emails?: SummaryEmailItem[] | undefined;
  summary?: string | undefined; // For low-priority batched items
}

/**
 * Upcoming reminders in AI output
 */
export interface UpcomingReminders {
  todos: {
    description: string;
    dueDate: string;
    relatedEmails: string[]; // Email IDs
  }[];
  events: {
    summary: string;
    start: string;
    relatedEmails: string[];
  }[];
}

/**
 * Summary statistics
 */
export interface SummaryStats {
  totalEmails: number;
  actionRequired: number;
  fyi: number;
  lowPriority: number;
}

/**
 * Complete inbox summary (AI output) - Original format
 */
export interface InboxSummary {
  summary: {
    greeting: string;
    overallTone: 'calm' | 'busy' | 'urgent';
    highlights: string[];
  };
  categories: EmailCategory[];
  upcomingReminders: UpcomingReminders;
  stats: SummaryStats;
}

/**
 * School-focused summary format (AI output) - New format
 */
export interface SchoolSummary {
  email_analysis: {
    total_received: number;
    signal_count: number;
    noise_count: number;
    noise_examples?: string[];
  };
  summary: Array<{
    child: string;
    icon: string;
    text: string;
  }>;
  kit_list: {
    tomorrow: Array<{
      item: string;
      context: string;
    }>;
    upcoming: Array<{
      item: string;
      day: string;
    }>;
  };
  financials: Array<{
    description: string;
    amount: string;
    deadline: string;
    url: string;
    payment_method?: string;
  }>;
  attachments_requiring_review: Array<{
    subject: string;
    from: string;
    reason: string;
  }>;
  calendar_updates: Array<{
    event: string;
    date: string;
    action: string;
  }>;
  recurring_activities: Array<{
    description: string;
    child: string;
    days_of_week: number[];  // [1, 2] = Monday, Tuesday (1=Mon, 7=Sun)
    frequency: string;       // "weekly" for now
    requires_kit: boolean;
    kit_items: string[];     // Empty array if no items mentioned
  }>;
  pro_dad_insight: string;
}

/**
 * Union type for both summary formats
 */
export type AnySummary = InboxSummary | SchoolSummary;

/**
 * Type guard to check if summary is SchoolSummary
 */
export function isSchoolSummary(summary: AnySummary): summary is SchoolSummary {
  return 'kit_list' in summary && 'pro_dad_insight' in summary;
}
