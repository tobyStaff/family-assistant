// src/types/childProfile.ts

/**
 * Child profile stored in database
 */
export interface ChildProfile {
  id?: number;
  user_id: string;
  real_name: string;              // Actual name from emails
  display_name?: string;          // Optional alias for privacy
  year_group?: string;            // e.g., "Year 3", "Reception"
  school_name?: string;           // School name
  is_active: boolean;             // Active enrollment
  onboarding_completed: boolean;  // User confirmed this profile
  confidence_score?: number;      // AI confidence (0.0-1.0)
  notes?: string;                 // User notes
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Child information extracted by AI from emails
 */
export interface ExtractedChildInfo {
  name: string;                   // Child name mentioned in emails
  year_group?: string;            // Year group if mentioned
  school_name?: string;           // School name if mentioned
  confidence: number;             // AI confidence (0.0-1.0)
  example_emails: string[];       // Sample email subjects where child was mentioned
}

/**
 * AI analysis result from onboarding scan
 */
export interface OnboardingAnalysisResult {
  children: ExtractedChildInfo[];
  schools_detected: string[];     // All schools mentioned
  email_count_analyzed: number;   // Number of emails analyzed
  date_range: {
    from: string;                 // ISO date
    to: string;                   // ISO date
  };
}
