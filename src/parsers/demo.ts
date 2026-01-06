#!/usr/bin/env tsx
// Quick demo script to test the NLP parser interactively
import { NlpParser } from './nlpParser.js';
import { hasCommandKeywords } from './parserRouter.js';

const parser = new NlpParser();

console.log('🧪 NLP Parser Demo\n');
console.log('Testing various email formats...\n');

// Test cases
const testEmails = [
  {
    name: 'Todo with relative date',
    content: '#todo Buy groceries tomorrow at 3pm',
  },
  {
    name: 'Task with "next Tuesday"',
    content: '#task Review PR next Tuesday',
  },
  {
    name: 'Calendar event',
    content: '#cal Team meeting on January 10th at 10am',
  },
  {
    name: 'Todo without date',
    content: '#todo Call the dentist',
  },
  {
    name: 'Task with "in 2 days"',
    content: '#addtask Deploy to production in 2 days',
  },
  {
    name: 'Alternative calendar keyword',
    content: '#event Conference on 2026-01-15',
  },
  {
    name: 'Non-command email (should return null)',
    content: 'Just a regular email with no commands',
  },
  {
    name: 'Case insensitive matching',
    content: '#TODO Fix the bug ASAP',
  },
  {
    name: 'Complex natural language',
    content: '#todo Send report to the team by end of next week',
  },
];

testEmails.forEach(({ name, content }, index) => {
  console.log(`${index + 1}. ${name}`);
  console.log(`   Input: "${content}"`);

  // Check if it has command keywords
  const hasKeywords = hasCommandKeywords(content);
  console.log(`   Has keywords: ${hasKeywords}`);

  // Parse it
  const result = parser.parse(content);

  if (result) {
    console.log(`   ✅ Parsed as: ${result.type}`);
    console.log(`   Description: "${result.description}"`);
    if (result.dueDate) {
      console.log(`   Due Date: ${result.dueDate.toLocaleString()}`);
    } else {
      console.log(`   Due Date: (none)`);
    }
  } else {
    console.log(`   ❌ Not a command email`);
  }

  console.log('');
});

console.log('\n✨ You can also test custom keywords:');
const customParser = new NlpParser({
  todo: ['!urgent', '!important']
});

const customTest = '!urgent Fix production bug';
console.log(`Input: "${customTest}"`);
const customResult = customParser.parse(customTest);
console.log(`Result:`, customResult);
