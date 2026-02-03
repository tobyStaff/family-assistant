// src/utils/senderRelevanceRanker.ts

import { OpenAI } from 'openai';

/**
 * Known school-related platforms, apps, and services.
 * Used to help identify school/family-relevant senders.
 */
export const SCHOOL_PLATFORMS = [
  // School Management Information Systems (MIS)
  'Arbor',
  'Bromcom',
  'SIMS Parent',
  'ScholarPack',

  // Communication platforms
  'ParentMail',
  'SchoolPost',
  'Operoo',
  'EduLink One',
  'Google Classroom',

  // Learning platforms - Maths
  'Sparx Maths',
  'MyMaths',
  'HegartyMaths',
  'DoodleMaths',
  'Times Tables Rock Stars',
  'TTRS',

  // Learning platforms - English/Reading
  'Sparx Reader',
  'DoodleEnglish',
  'Bedrock Learning',

  // Learning platforms - General
  'Satchel One',
  'Show My Homework',
  'Tassomai',
  'Century Tech',

  // Payment systems
  'Scopay',
  'Tucasi',
  'ParentPay',
  'SchoolGateway',
  'sQuid',
  'Wisepay',

  // Trips & clubs
  'Evolve',
  'Magicbooking',

  // Parent communities
  'Classlist',
  'ClassDojo',

  // Early Years / Nursery
  'Tapestry',
  'Seesaw',
  'Evidence Me',
  'MarvellousMe',
] as const;

/**
 * Common domain patterns for school platforms (lowercase for matching)
 */
export const SCHOOL_PLATFORM_DOMAINS = [
  'arbor-education.com',
  'bromcom.com',
  'sims.co.uk',
  'scholarpack.com',
  'parentmail.co.uk',
  'schoolpost.co.uk',
  'operoo.com',
  'edulinkone.com',
  'classroom.google.com',
  'sparxmaths.com',
  'sparxreader.com',
  'satchelone.com',
  'showmyhomework.co.uk',
  'tassomai.com',
  'century.tech',
  'ttrockstars.com',
  'doodlemaths.com',
  'doodlelearning.com',
  'mymaths.co.uk',
  'hegartymaths.com',
  'bedrocklearning.org',
  'scopay.com',
  'tucasi.com',
  'parentpay.com',
  'schoolgateway.com',
  'squidcard.com',
  'evolveedvisits.com',
  'magicbooking.co.uk',
  'classlist.com',
  'classdojo.com',
  'tapestryjournal.com',
  'seesaw.me',
  'evidenceme.com',
  'marvellousme.com',
  'wisepay.co.uk',
] as const;

interface SenderInput {
  email: string;
  name: string;
  subjects: string[];
  count: number;
}

export interface RankedSender extends SenderInput {
  relevance: number;
  category: 'school' | 'activity' | 'other';
}

/**
 * Check if a domain matches any known school platform domain.
 */
function matchesSchoolPlatform(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  return SCHOOL_PLATFORM_DOMAINS.some(
    platformDomain => lowerDomain === platformDomain || lowerDomain.endsWith('.' + platformDomain)
  );
}

/**
 * Check if sender name contains a known school platform name.
 */
function nameMatchesSchoolPlatform(name: string): boolean {
  const lowerName = name.toLowerCase();
  return SCHOOL_PLATFORMS.some(platform => lowerName.includes(platform.toLowerCase()));
}

/**
 * Check if the email local part (before @) contains a school platform keyword.
 * Handles cases like classroom-noreply@google.com
 */
function emailLocalPartMatchesSchoolPlatform(email: string): boolean {
  const localPart = email.split('@')[0]?.toLowerCase() || '';
  const schoolKeywords = ['classroom', 'sparx', 'satchel', 'doodle', 'tassomai', 'classdojo', 'seesaw', 'tapestry'];
  return schoolKeywords.some(keyword => localPart.includes(keyword));
}

/**
 * Rank senders by relevance to school/family using GPT-4o-mini.
 * Known school platforms are automatically ranked highest.
 * Only sends privacy-safe data: domain, display name, up to 3 subject lines.
 */
export async function rankSenderRelevance(
  senders: SenderInput[]
): Promise<RankedSender[]> {
  if (senders.length === 0) return [];

  // Pre-score known school platforms (no AI needed)
  const scores: { relevance: number; category: 'school' | 'activity' | 'other' }[] = senders.map(s => {
    const domain = s.email.split('@')[1] || '';
    if (matchesSchoolPlatform(domain) || nameMatchesSchoolPlatform(s.name) || emailLocalPartMatchesSchoolPlatform(s.email)) {
      return { relevance: 0.95, category: 'school' as const };
    }
    return { relevance: 0.5, category: 'other' as const };
  });

  // Find senders that need AI ranking (not already matched to known platforms)
  const needsAiRanking = senders
    .map((s, i) => ({ sender: s, index: i }))
    .filter((_, i) => scores[i].relevance < 0.9);

  const preRankedCount = senders.length - needsAiRanking.length;
  console.log(`[senderRelevanceRanker] ${preRankedCount} senders matched known school platforms, ${needsAiRanking.length} need AI ranking`);

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey || needsAiRanking.length === 0) {
    if (!apiKey && needsAiRanking.length > 0) {
      console.warn('[senderRelevanceRanker] No AI_API_KEY, skipping AI ranking for unknown senders');
    }
    // Return with pre-scored values
    return senders.map((s, i) => ({
      ...s,
      relevance: scores[i].relevance,
      category: scores[i].category,
    })).sort((a, b) => b.relevance - a.relevance);
  }

  const openai = new OpenAI({ apiKey });

  // Build privacy-safe sender summaries for AI ranking
  const senderSummaries = needsAiRanking.map(({ sender, index }) => {
    const domain = sender.email.split('@')[1] || 'unknown';
    const subjects = sender.subjects.slice(0, 3).join(' | ');
    return { index, domain, name: sender.name, subjects };
  });

  // Batch into chunks of 50 to avoid token limits
  const BATCH_SIZE = 50;

  for (let batchStart = 0; batchStart < senderSummaries.length; batchStart += BATCH_SIZE) {
    const batch = senderSummaries.slice(batchStart, batchStart + BATCH_SIZE);

    const prompt = `You are classifying email senders for a family/school inbox assistant.

For each sender below, score how likely they are to be relevant to school or family life (children's activities, school communications, childcare, clubs, etc).

Return a JSON array with one object per sender:
- "index": the sender index
- "relevance": float 0.0-1.0 (0.9-1.0 = definitely school/family, 0.5-0.8 = possibly relevant, 0.0-0.4 = unlikely)
- "category": "school" | "activity" | "other"

Senders:
${JSON.stringify(batch, null, 2)}

Return ONLY the JSON array, no other text.`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const parsed = JSON.parse(content);
      const results = Array.isArray(parsed) ? parsed : parsed.senders || parsed.results || [];

      for (const result of results) {
        // result.index is the original global index from senderSummaries
        const globalIndex = result.index ?? -1;
        if (globalIndex >= 0 && globalIndex < senders.length) {
          scores[globalIndex] = {
            relevance: Math.max(0, Math.min(1, result.relevance ?? 0.5)),
            category: ['school', 'activity', 'other'].includes(result.category) ? result.category : 'other',
          };
        }
      }
    } catch (err: any) {
      console.error('[senderRelevanceRanker] AI ranking failed for batch:', err.message);
      // Keep default scores for this batch
    }
  }

  // Merge scores with senders and sort by relevance desc
  return senders.map((s, i) => ({
    ...s,
    relevance: scores[i].relevance,
    category: scores[i].category,
  })).sort((a, b) => b.relevance - a.relevance);
}
