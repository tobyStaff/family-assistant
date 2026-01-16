# Daily Email Summary Implementation Plan

## Overview
Build a system that processes inbox emails, uses AI to generate summaries, and sends personalized daily digest emails to configured recipients.

---

## 1. Database Schema Changes

### Add `user_settings` table
```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  summary_email_recipients TEXT,  -- JSON array of email addresses
  summary_enabled BOOLEAN DEFAULT 1,
  summary_time_utc INTEGER DEFAULT 8,  -- Hour in UTC (0-23)
  timezone TEXT DEFAULT 'UTC',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

**Example data:**
```json
summary_email_recipients: ["user@example.com", "assistant@example.com"]
```

### Add `email_summaries` table (for caching/history)
```sql
CREATE TABLE IF NOT EXISTS email_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  summary_date DATE NOT NULL,
  inbox_count INTEGER,
  summary_json TEXT,  -- Full AI-generated summary
  sent_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, summary_date)
);
```

---

## 2. Inbox Processing Strategy

### **RECOMMENDATION: Batch Processing with AI**

**Why batch over individual:**
1. **Context awareness**: AI can identify themes/patterns across multiple emails
2. **Deduplication**: Automatically group related emails (email threads, same topic)
3. **Prioritization**: AI can rank importance across all emails
4. **Cost efficient**: One AI call instead of N calls
5. **Better summaries**: AI sees the big picture

### Processing flow:
```
1. Fetch unread emails from last 24 hours (Gmail API)
2. Extract: subject, sender, snippet, date, labels
3. Combine into single context document
4. Send to AI with structured prompt
5. AI returns structured JSON summary
6. Generate HTML email from JSON
7. Send to recipient list
8. Mark emails as processed (optional: add label)
```

### Fetch strategy:
- Query: `is:unread after:${yesterday} -in:spam -in:trash`
- Limit: 100 emails (configurable)
- Include: subject, from, snippet (first 200 chars), date, labels
- Exclude: Full body (too token-heavy)

---

## 3. AI Analysis Schema

### Input to AI (what we send):

```typescript
{
  "date": "2026-01-09",
  "emailCount": 25,
  "emails": [
    {
      "id": "msg_123",
      "from": "john@example.com",
      "fromName": "John Doe",
      "subject": "Q4 Budget Review",
      "snippet": "Hi, I've attached the Q4 budget analysis. Can we discuss tomorrow?",
      "receivedAt": "2026-01-09T14:30:00Z",
      "labels": ["IMPORTANT", "CATEGORY_WORK"],
      "hasAttachments": true
    },
    // ... more emails
  ],
  "upcomingTodos": [
    { "description": "Finish budget report", "dueDate": "2026-01-10" }
  ],
  "upcomingEvents": [
    { "summary": "Team Meeting", "start": "2026-01-10T10:00:00Z" }
  ]
}
```

### Output from AI (structured JSON):

```typescript
{
  "summary": {
    "greeting": "Good morning! Here's what happened in your inbox yesterday.",
    "overallTone": "busy",  // calm | busy | urgent
    "highlights": [
      "Q4 budget review from John needs your attention",
      "3 meeting invites for next week",
      "GitHub notifications about PR #145"
    ]
  },
  "categories": [
    {
      "name": "Action Required",
      "priority": "high",
      "count": 5,
      "emails": [
        {
          "from": "John Doe",
          "subject": "Q4 Budget Review",
          "summary": "Budget analysis attached, wants to discuss tomorrow",
          "actionNeeded": "Review attachment and schedule meeting",
          "deadline": "2026-01-10"
        }
      ]
    },
    {
      "name": "FYI / Updates",
      "priority": "medium",
      "count": 12,
      "emails": [
        {
          "from": "GitHub",
          "subject": "PR #145 merged",
          "summary": "Your pull request was merged into main",
          "actionNeeded": null
        }
      ]
    },
    {
      "name": "Newsletters / Marketing",
      "priority": "low",
      "count": 8,
      "summary": "8 promotional emails (batched for brevity)"
    }
  ],
  "upcomingReminders": {
    "todos": [
      {
        "description": "Finish budget report",
        "dueDate": "2026-01-10",
        "relatedEmails": ["msg_123"]  // Links to email IDs
      }
    ],
    "events": [
      {
        "summary": "Team Meeting",
        "start": "2026-01-10T10:00:00Z",
        "relatedEmails": []
      }
    ]
  },
  "stats": {
    "totalEmails": 25,
    "actionRequired": 5,
    "fyi": 12,
    "lowPriority": 8
  }
}
```

### AI Prompt template:

```
You are an executive assistant analyzing yesterday's email inbox to create a personalized daily summary.

**Context:**
- Date: {date}
- Total emails: {emailCount}
- Upcoming TODOs and calendar events are also provided for context

**Task:**
Analyze the emails and categorize them into:
1. Action Required (needs response/decision)
2. FYI / Updates (informational)
3. Newsletters / Marketing (low priority)

For "Action Required" emails:
- Provide a concise summary (1 sentence)
- Identify specific action needed
- Note any deadlines

For "FYI" emails:
- Brief summary
- Group similar topics (e.g., "5 GitHub notifications")

For newsletters:
- Just count them, don't list individually

**Output format:**
Return valid JSON matching this schema: {schema}

**Guidelines:**
- Be concise but informative
- Prioritize actionable items
- Link related emails to TODOs/events when relevant
- Use friendly, professional tone
- If there are email threads, group them together
```

---

## 4. Email Template Design

### HTML Email Structure:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    /* Mobile-responsive, clean design */
    body { font-family: -apple-system, sans-serif; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; }
    .greeting { font-size: 18px; color: #333; margin-bottom: 20px; }
    .category { margin: 30px 0; }
    .category-header {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a1a;
      padding: 10px 0;
      border-bottom: 2px solid #e0e0e0;
    }
    .email-item {
      padding: 15px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .email-from { font-weight: 600; color: #333; }
    .email-subject { color: #666; font-size: 14px; }
    .email-summary { margin-top: 5px; color: #444; }
    .action-badge {
      background: #ff6b6b;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .stats {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin-top: 30px;
    }
    .priority-high { border-left: 4px solid #ff6b6b; padding-left: 12px; }
    .priority-medium { border-left: 4px solid #ffa500; padding-left: 12px; }
    .priority-low { border-left: 4px solid #999; padding-left: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Greeting -->
    <div class="greeting">{greeting}</div>

    <!-- Highlights -->
    <div class="highlights">
      <ul>
        {highlights}
      </ul>
    </div>

    <!-- Action Required -->
    <div class="category priority-high">
      <div class="category-header">
        ⚡ Action Required ({actionCount})
      </div>
      {actionItems}
    </div>

    <!-- FYI / Updates -->
    <div class="category priority-medium">
      <div class="category-header">
        📬 FYI / Updates ({fyiCount})
      </div>
      {fyiItems}
    </div>

    <!-- Low Priority -->
    <div class="category priority-low">
      <div class="category-header">
        📰 Newsletters & Other ({lowPriorityCount})
      </div>
      <p style="color: #666;">{lowPrioritySummary}</p>
    </div>

    <!-- Upcoming -->
    <div class="category">
      <div class="category-header">
        📅 Your Day Ahead
      </div>
      {upcomingTodos}
      {upcomingEvents}
    </div>

    <!-- Stats -->
    <div class="stats">
      <strong>Summary:</strong> {totalEmails} emails processed
      <br>
      {actionCount} need action • {fyiCount} for review • {lowPriorityCount} skippable
    </div>
  </div>
</body>
</html>
```

---

## 5. Manual Testing Endpoint

### New route: POST `/admin/send-daily-summary`

**Request body:**
```json
{
  "userId": "114073782686201541052",  // Optional, defaults to authenticated user
  "testRecipients": ["test@example.com"],  // Override recipients for testing
  "dateRange": "yesterday"  // or "last7days", "today"
}
```

**Response:**
```json
{
  "success": true,
  "emailsSent": 2,
  "recipients": ["test@example.com", "user@example.com"],
  "summary": {
    "totalEmails": 25,
    "categorized": {
      "actionRequired": 5,
      "fyi": 12,
      "lowPriority": 8
    }
  },
  "previewUrl": "/admin/preview-summary/{id}"  // Optional: view HTML
}
```

### Add preview endpoint: GET `/admin/preview-summary/:id`
Returns the generated HTML for browser preview

---

## 6. Settings Management

### New routes:

**GET `/settings`** - Get user settings
```json
{
  "summaryEmailRecipients": ["user@example.com"],
  "summaryEnabled": true,
  "summaryTimeUtc": 8,
  "timezone": "UTC"
}
```

**PUT `/settings`** - Update settings
```json
{
  "summaryEmailRecipients": ["user@example.com", "assistant@example.com"],
  "summaryEnabled": true,
  "summaryTimeUtc": 7
}
```

---

## 7. Implementation Sequence

### Phase 1: Database & Settings (Day 1)
1. Add `user_settings` table to `src/db/db.ts`
2. Add `email_summaries` table
3. Create `src/db/settingsDb.ts` with CRUD operations
4. Create `src/routes/settingsRoutes.ts` with GET/PUT endpoints
5. Register routes in `app.ts`
6. Test: Create/update settings via API

### Phase 2: Inbox Processing (Day 2)
1. Create `src/utils/inboxFetcher.ts`
   - Function: `fetchRecentEmails(auth, dateRange)`
   - Returns array of email metadata
2. Create `src/utils/emailPreprocessor.ts`
   - Function: `prepareEmailsForAI(emails, todos, events)`
   - Returns formatted input JSON
3. Test: Fetch real emails, log JSON output

### Phase 3: AI Analysis (Day 3)
1. Create `src/parsers/summaryParser.ts`
   - Function: `analyzeInbox(inputData, provider)`
   - Uses OpenAI or Anthropic with structured prompt
   - Returns typed summary JSON
2. Define schema types in `src/types/summary.ts`
3. Test: Send test data, verify JSON output

### Phase 4: Email Rendering (Day 4)
1. Create `src/utils/emailRenderer.ts`
   - Function: `renderSummaryEmail(summaryJson)`
   - Takes AI output, generates HTML
   - Use template literals or a simple templating engine
2. Test: Render sample JSON to HTML, view in browser

### Phase 5: Integration (Day 5)
1. Update `src/utils/summaryQueries.ts`
   - Add function: `generateInboxSummary(userId, auth, dateRange)`
   - Calls: fetch → preprocess → AI analyze → render
2. Update `src/utils/emailSender.ts`
   - Function: `sendInboxSummary(auth, summary, recipients)`
3. Test: End-to-end with test recipient

### Phase 6: Manual Testing Endpoint (Day 6)
1. Create `src/routes/adminRoutes.ts`
   - POST `/admin/send-daily-summary`
   - GET `/admin/preview-summary/:id` (optional)
2. Add authentication (admin-only or dev-mode only)
3. Test: Trigger multiple times, iterate on prompt/template

### Phase 7: Cron Integration (Day 7)
1. Update `src/plugins/dailySummary.ts`
   - Add inbox summary generation to existing cron
   - Fetch settings per user
   - Skip if `summaryEnabled = false`
   - Use `summaryEmailRecipients` instead of user email
2. Test: Wait for cron or manually trigger job

### Phase 8: Polish & Documentation
1. Add error handling for:
   - Gmail API quota limits
   - AI API failures
   - Invalid email addresses
2. Add logging/metrics
3. Update README with:
   - How to configure recipients
   - How to test manually
   - Prompt tuning guide

---

## 8. Key Design Decisions

### Why batch processing?
- **Better AI understanding**: Sees patterns across emails
- **Cost effective**: 1 AI call vs 100
- **Smarter categorization**: Can group related topics
- **Automatic deduplication**: Recognizes email threads

### Why structured JSON schema?
- **Consistent formatting**: Easy to render
- **Testable**: Can validate output
- **Evolvable**: Add fields without breaking
- **Debuggable**: Can inspect AI output

### Why separate test endpoint?
- **Rapid iteration**: Test without waiting for cron
- **Override recipients**: Test with your email only
- **Preview HTML**: See output before sending
- **Tune prompts**: Adjust AI instructions based on results

### Why store summaries?
- **History**: See past summaries
- **Analytics**: Track email volume over time
- **Debugging**: Review what was sent
- **Cost tracking**: Monitor AI usage

---

## 9. Estimated Costs

**AI Analysis (per user per day):**
- Input: ~100 emails × 50 tokens = 5,000 tokens
- Output: ~1,500 tokens (structured JSON)
- **OpenAI GPT-4o**: ~$0.03/day/user
- **Anthropic Claude**: ~$0.04/day/user

**Gmail API:**
- Free up to 1 billion quota units/day
- Listing messages: 5 units/call
- Very unlikely to hit limits

---

## 10. Sample File Structure

```
src/
├── db/
│   ├── settingsDb.ts          # NEW: User settings CRUD
│   └── summaryDb.ts           # NEW: Summary history CRUD
├── routes/
│   ├── settingsRoutes.ts      # NEW: GET/PUT settings
│   └── adminRoutes.ts         # NEW: Manual test trigger
├── utils/
│   ├── inboxFetcher.ts        # NEW: Fetch Gmail emails
│   ├── emailPreprocessor.ts   # NEW: Format for AI
│   └── emailRenderer.ts       # NEW: JSON → HTML
├── parsers/
│   └── summaryParser.ts       # NEW: AI analysis
└── types/
    └── summary.ts             # NEW: TypeScript interfaces
```

---

## 11. Testing Plan

### Unit Tests
- `inboxFetcher`: Mock Gmail API responses
- `emailPreprocessor`: Test JSON formatting
- `summaryParser`: Mock AI API calls
- `emailRenderer`: Test HTML generation

### Integration Tests
- Full flow: Fetch → Process → AI → Render → Send
- Test with various email counts (0, 1, 100)
- Test with missing TODOs/events
- Test with AI API failures

### Manual Testing Checklist
- [ ] Fetch real emails from test account
- [ ] AI generates valid JSON
- [ ] HTML renders correctly in Gmail/Outlook
- [ ] Mobile-responsive email
- [ ] Links work correctly
- [ ] Unsubscribe handling (optional)
- [ ] Multiple recipients receive email
- [ ] Empty inbox handled gracefully

---

## Next Steps

Ready to begin implementation with Phase 1: Database & Settings.
