// src/parsers/demo-extraction.ts
// Demo script to test event/todo extraction

import 'dotenv/config';
import { extractEventsAndTodos } from './eventTodoExtractor.js';
import type { EmailMetadata } from '../types/summary.js';

/**
 * Sample emails for testing extraction
 */
const sampleEmails: EmailMetadata[] = [
  {
    id: 'test-email-1',
    from: 'office@stmarys.school.uk',
    fromName: 'St Mary\'s School Office',
    subject: 'Year 3 Trip to Natural History Museum - Payment Required',
    receivedAt: '2026-01-10T10:00:00Z',
    snippet: 'Reminder: School trip on Friday 17th January. Payment of £15 per child due by Wednesday...',
    labels: ['INBOX'],
    hasAttachments: false,
    bodyText: `Dear Parents,

This is a reminder that Year 3 will be visiting the Natural History Museum on Friday 17th January 2026.

The trip will depart at 9:00 AM and return by 3:30 PM.

PAYMENT REQUIRED:
- Cost: £15.00 per child
- Deadline: Wednesday 15th January
- Payment via ParentPay: https://www.parentpay.com/trip-123

Please ensure your child brings:
- Packed lunch
- Water bottle
- Warm coat

Regards,
St Mary's School Office`,
  },
  {
    id: 'test-email-2',
    from: 'miss.jones@stmarys.school.uk',
    fromName: 'Miss Jones',
    subject: 'PE Days and Kit Reminder for Ella',
    receivedAt: '2026-01-12T14:30:00Z',
    snippet: 'Reminder that Ella needs her PE kit tomorrow for outdoor games...',
    labels: ['INBOX'],
    hasAttachments: false,
    bodyText: `Hi,

Quick reminder that Ella needs her PE kit tomorrow (Monday) for outdoor games.

Please ensure she has:
- PE kit
- Trainers
- Warm tracksuit (it's cold!)

Also, please sign and return the medical form by Friday.

Thanks,
Miss Jones`,
  },
  {
    id: 'test-email-3',
    from: 'headteacher@stmarys.school.uk',
    fromName: 'Head Teacher',
    subject: 'Inset Day - School Closed',
    receivedAt: '2026-01-08T09:00:00Z',
    snippet: 'Important: School will be closed for staff training on Monday 20th January...',
    labels: ['INBOX'],
    hasAttachments: false,
    bodyText: `Dear Parents and Carers,

This is to remind you that school will be CLOSED on Monday 20th January 2026 for an Inset Day (staff training).

School will reopen as normal on Tuesday 21st January.

Thank you for your understanding.

Best regards,
Mr. Smith
Head Teacher`,
  },
];

/**
 * Run extraction demo
 */
async function runDemo() {
  console.log('📧 Testing Event/Todo Extraction with Sample Emails\n');
  console.log(`Analyzing ${sampleEmails.length} sample emails...\n`);

  try {
    const result = await extractEventsAndTodos(sampleEmails, 'openai');

    console.log('✅ Extraction Complete!\n');
    console.log(`📅 Events Found: ${result.events.length}`);
    result.events.forEach((event, i) => {
      console.log(`\n  Event ${i + 1}:`);
      console.log(`    Title: ${event.title}`);
      console.log(`    Date: ${event.date}`);
      console.log(`    Child: ${event.child_name || 'General'}`);
      console.log(`    Confidence: ${Math.round(event.confidence * 100)}%`);
      if (event.description) {
        console.log(`    Description: ${event.description}`);
      }
    });

    console.log(`\n\n📝 Todos Found: ${result.todos.length}`);
    result.todos.forEach((todo, i) => {
      console.log(`\n  Todo ${i + 1}:`);
      console.log(`    Description: ${todo.description}`);
      console.log(`    Type: ${todo.type}`);
      console.log(`    Child: ${todo.child_name || 'General'}`);
      if (todo.due_date) {
        console.log(`    Due: ${todo.due_date}`);
      }
      if (todo.amount) {
        console.log(`    Amount: ${todo.amount}`);
      }
      if (todo.url) {
        console.log(`    URL: ${todo.url}`);
      }
      console.log(`    Confidence: ${Math.round(todo.confidence * 100)}%`);
    });

    console.log(`\n\n📊 Summary:`);
    console.log(`  Emails analyzed: ${result.emails_analyzed}`);
    console.log(`  Events extracted: ${result.events.length}`);
    console.log(`  Todos extracted: ${result.todos.length}`);
    console.log(`  Timestamp: ${result.extraction_timestamp}`);

  } catch (error: any) {
    console.error('❌ Extraction failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo()
    .then(() => {
      console.log('\n✅ Demo completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Demo failed:', error);
      process.exit(1);
    });
}
