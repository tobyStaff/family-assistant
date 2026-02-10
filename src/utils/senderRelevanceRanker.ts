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
  school_name?: string;
  year_hints?: string[];
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
 * Attempt to extract a school name from a sender's display name.
 * Returns the name if it doesn't appear to be just a platform name.
 */
function extractSchoolNameFromSender(name: string): string {
  if (!name) return '';
  const lowerName = name.toLowerCase().trim();
  // If the name is exactly a known platform name, it's not a school name
  const isJustPlatform = SCHOOL_PLATFORMS.some(p => lowerName === p.toLowerCase());
  if (isJustPlatform) return '';
  // If the name contains school-like keywords, it's likely a school name
  const schoolKeywords = ['school', 'primary', 'academy', 'college', 'nursery', 'infant', 'junior', 'prep', 'grammar', 'high school', 'secondary'];
  if (schoolKeywords.some(k => lowerName.includes(k))) return name.trim();
  return '';
}

/**
 * Rank senders by relevance to school/family using GPT-4o-mini.
 * Known school platforms are automatically ranked highest.
 * Only sends privacy-safe data: domain, display name, up to 3 subject lines.
 */
export async function rankSenderRelevance(
  senders: SenderInput[]
): Promise<RankedSender[]> {
  console.log(`[rankSenderRelevance] Called with ${senders.length} senders`);
  if (senders.length === 0) {
    console.log(`[rankSenderRelevance] No senders, returning empty`);
    return [];
  }

  // Pre-score known school platforms (no AI needed)
  const scores: { relevance: number; category: 'school' | 'activity' | 'other'; school_name: string; year_hints: string[] }[] = senders.map(s => {
    const domain = s.email.split('@')[1] || '';
    if (matchesSchoolPlatform(domain) || nameMatchesSchoolPlatform(s.name) || emailLocalPartMatchesSchoolPlatform(s.email)) {
      // Attempt basic school name extraction from sender name
      // If the name isn't just a platform name, it may contain the school name
      const schoolName = extractSchoolNameFromSender(s.name);
      return { relevance: 0.95, category: 'school' as const, school_name: schoolName, year_hints: [] };
    }
    return { relevance: 0.5, category: 'other' as const, school_name: '', year_hints: [] };
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
      school_name: scores[i].school_name || undefined,
      year_hints: scores[i].year_hints.length > 0 ? scores[i].year_hints : undefined,
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
- "school_name": extract the school name if sender appears to be a school (from name or domain), or "" if not a school
- "year_hints": array of year groups found in subjects (e.g. ["Year 3", "Reception"]), or [] if none found

Senders:
${JSON.stringify(batch, null, 2)}

Return ONLY the JSON array, no other text.`;

    try {
      console.log(`[senderRelevanceRanker] Calling OpenAI for batch ${batchStart}-${batchStart + batch.length}...`);

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenAI API timeout after 30s')), 30000)
      );

      const apiPromise = openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);

      const content = response.choices[0]?.message?.content?.trim() || '';
      console.log(`[senderRelevanceRanker] OpenAI response received, parsing...`);
      const parsed = JSON.parse(content);
      const results = Array.isArray(parsed) ? parsed : parsed.senders || parsed.results || [];

      for (const result of results) {
        // result.index is the original global index from senderSummaries
        const globalIndex = result.index ?? -1;
        if (globalIndex >= 0 && globalIndex < senders.length) {
          scores[globalIndex] = {
            relevance: Math.max(0, Math.min(1, result.relevance ?? 0.5)),
            category: ['school', 'activity', 'other'].includes(result.category) ? result.category : 'other',
            school_name: typeof result.school_name === 'string' ? result.school_name : '',
            year_hints: Array.isArray(result.year_hints) ? result.year_hints.filter((h: unknown) => typeof h === 'string') : [],
          };
        }
      }
      console.log(`[senderRelevanceRanker] Batch complete, scored ${results.length} senders`);
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
    school_name: scores[i].school_name || undefined,
    year_hints: scores[i].year_hints.length > 0 ? scores[i].year_hints : undefined,
  })).sort((a, b) => b.relevance - a.relevance);
}

/**
 * Re-rank candidate senders using approved senders as context.
 * Uses GPT-4o-mini to re-score candidates based on patterns in what the user approved.
 * Falls back to original ordering if API key is missing or call fails.
 */
export async function rerankSendersWithContext(
  approvedSenders: RankedSender[],
  candidateSenders: RankedSender[]
): Promise<RankedSender[]> {
  if (candidateSenders.length === 0) return [];

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey || approvedSenders.length === 0) {
    console.log('[senderRelevanceRanker] Skipping rerank — no API key or no approved senders');
    return candidateSenders.sort((a, b) => b.relevance - a.relevance);
  }

  const openai = new OpenAI({ apiKey });

  // Build privacy-safe context from approved senders
  const approvedContext = approvedSenders.map(s => ({
    domain: s.email.split('@')[1] || 'unknown',
    name: s.name,
    subjects: s.subjects.slice(0, 3),
  }));

  // Build privacy-safe candidate summaries
  const candidateSummaries = candidateSenders.map((s, index) => ({
    index,
    domain: s.email.split('@')[1] || 'unknown',
    name: s.name,
    subjects: s.subjects.slice(0, 3),
  }));

  const BATCH_SIZE = 50;
  const rerankedScores = candidateSenders.map(s => s.relevance);

  for (let batchStart = 0; batchStart < candidateSummaries.length; batchStart += BATCH_SIZE) {
    const batch = candidateSummaries.slice(batchStart, batchStart + BATCH_SIZE);

    const prompt = `You are re-ranking email senders for a family/school inbox assistant.

The user has already approved these senders as relevant to their family:
${JSON.stringify(approvedContext, null, 2)}

Based on those approved senders, re-score how likely each candidate sender below is to also be relevant (school, clubs, childcare, family activities, etc).

Return a JSON array with one object per candidate:
- "index": the candidate index
- "relevance": float 0.0-1.0 (higher = more likely relevant given the approved senders)

Candidates:
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
      const results = Array.isArray(parsed) ? parsed : parsed.senders || parsed.results || parsed.candidates || [];

      for (const result of results) {
        const idx = result.index ?? -1;
        if (idx >= 0 && idx < candidateSenders.length) {
          rerankedScores[idx] = Math.max(0, Math.min(1, result.relevance ?? rerankedScores[idx]));
        }
      }
    } catch (err: any) {
      console.error('[senderRelevanceRanker] Rerank failed for batch:', err.message);
      // Keep original scores for this batch
    }
  }

  console.log(`[senderRelevanceRanker] Re-ranked ${candidateSenders.length} candidates with ${approvedSenders.length} approved senders as context`);

  return candidateSenders.map((s, i) => ({
    ...s,
    relevance: rerankedScores[i],
  })).sort((a, b) => b.relevance - a.relevance);
}
