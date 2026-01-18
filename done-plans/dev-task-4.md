# Dev Task 4
## Improve AI responses

1. The problem is shown by this example:

The raw email:
Fix Ella's pe shoes for this Wednesday morning.

The AI response:
{
  "human_analysis": {
    "email_summary": "The email is a reminder to fix Ella's PE shoes by Wednesday morning.",
    "email_tone": "informative",
    "email_intent": "action required",
    "implicit_context": "Assumes the reader knows the schedule for PE days and the need for proper shoes."
  },
  "events": [
    {
      "title": "PE Day",
      "date": "2026-01-16T09:00:00Z",
      "end_date": "",
      "description": "PE day for Ella, requires proper shoes.",
      "location": "",
      "child_name": "Ella",
      "source_email_id": "",
      "confidence": 0.8,
      "recurring": true,
      "recurrence_pattern": "weekly on Wednesdays",
      "time_of_day": "morning",
      "inferred_date": true
    }
  ],
  "todos": [
    {
      "description": "Fix Ella's PE shoes",
      "type": "PACK",
      "due_date": "2026-01-16T09:00:00Z",
      "child_name": "Ella",
      "source_email_id": "",
      "url": "",
      "amount": "",
      "confidence": 0.9,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    }
  ],
  "emails_analyzed": 1,
  "extraction_timestamp": "2026-01-16T21:03:13.770Z"
}

AI is not reading the intent correctly. The raw content clearly states that there is a task to fix pe shoes for this Wednesday.

It should infer that: 
1. this is a one off (this wednesday)
2. this is an event where a reminder can be set (wednesday 9am)
3. this is a todo to fix the shoes by that day.
