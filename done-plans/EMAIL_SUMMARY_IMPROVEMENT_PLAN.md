# Email Summary Improvement Plan

**Date**: 2026-01-11
**Status**: Draft for Review

---

## 🚨 Critical Issues Identified

### 1. **AI Hallucination - WhatsApp Data**
**Problem**: AI reports analyzing 50 WhatsApp messages when we provide ZERO WhatsApp data.

**Root Cause**:
- Prompt mentions "Raw text from the 'Year 4 Parents' WhatsApp group"
- AI generates fake data to match the schema
- We never actually fetch or process WhatsApp messages

**Impact**: **CRITICAL** - Undermines trust in the entire summary

---

### 2. **Inconsistent Section Display**
**Problem**: Sections may appear/disappear unpredictably based on AI interpretation

**Examples**:
- Sometimes shows empty kit lists, sometimes omits them
- Financial section may be absent even when payments mentioned
- Attachment section inconsistently flagged

**Impact**: **HIGH** - User can't rely on summary structure

---

### 3. **No Data Validation**
**Problem**: We trust AI output blindly without validation

**Missing Checks**:
- ✗ Verify `total_received` matches actual email count
- ✗ Verify `signal_count + noise_count = total_received`
- ✗ Validate date formats (ISO8601)
- ✗ Ensure required fields are never empty strings
- ✗ Check URLs are valid

**Impact**: **HIGH** - Bad data goes directly to user

---

### 4. **Ambiguous Prompt Instructions**
**Problem**: Prompt allows AI too much creative freedom

**Examples**:
- "Look for dates, times, kit requirements" - vague
- "If email is school-related but has minimal body text" - undefined threshold
- "Ignore noise in WhatsApp" - but we don't provide WhatsApp data

**Impact**: **MEDIUM** - Inconsistent results across runs

---

## 📋 Improvement Plan

### Phase 1: Remove WhatsApp (Immediate) ⚠️ **CRITICAL**

**Goal**: Stop AI hallucination by removing unimplemented features

**Changes**:

1. **Update Prompt** (`src/parsers/summaryParser.ts`):
   ```diff
   - **Input:**
   - - Raw text from 24 hours of school emails.
   - - Raw text from the 'Year 4 Parents' WhatsApp group.
   + **Input:**
   + - Raw email data from Gmail (emails only - no WhatsApp or other sources)
   ```

2. **Remove WhatsApp from Schema**:
   ```typescript
   // REMOVE this field from SchoolSummary
   whatsapp_filter: {
     signal: string;
     messages_analyzed: number;
     noise_count: number;
   };
   ```

3. **Update Renderer** - Remove WhatsApp section entirely

4. **Future**: Add back when we implement actual WhatsApp integration

**Estimated Time**: 30 minutes
**Priority**: **P0 - MUST DO IMMEDIATELY**

---

### Phase 2: Add Strict Data Validation (High Priority)

**Goal**: Catch AI errors before rendering email

**Validation Functions** (`src/utils/summaryValidator.ts`):

```typescript
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSchoolSummary(
  summary: SchoolSummary,
  expectedEmailCount: number
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // CRITICAL: Email counts must match
  if (summary.email_analysis.total_received !== expectedEmailCount) {
    errors.push(
      `Email count mismatch: AI reported ${summary.email_analysis.total_received} but we sent ${expectedEmailCount}`
    );
  }

  // Signal + Noise must equal Total
  const sum = summary.email_analysis.signal_count + summary.email_analysis.noise_count;
  if (sum !== summary.email_analysis.total_received) {
    errors.push(
      `Signal (${summary.email_analysis.signal_count}) + Noise (${summary.email_analysis.noise_count}) != Total (${summary.email_analysis.total_received})`
    );
  }

  // Validate financials
  summary.financials.forEach((fin, idx) => {
    if (!fin.amount) {
      errors.push(`Financial item ${idx + 1}: Missing amount`);
    }
    if (!fin.deadline) {
      errors.push(`Financial item ${idx + 1}: Missing deadline`);
    }
    // Validate ISO date
    if (fin.deadline && isNaN(Date.parse(fin.deadline))) {
      errors.push(`Financial item ${idx + 1}: Invalid date format`);
    }
    // Validate URL if not manual_check_required
    if (fin.url && fin.url !== 'manual_check_required') {
      try {
        new URL(fin.url);
      } catch {
        warnings.push(`Financial item ${idx + 1}: Invalid URL format`);
      }
    }
  });

  // Validate calendar updates
  summary.calendar_updates.forEach((cal, idx) => {
    if (!cal.date || isNaN(Date.parse(cal.date))) {
      errors.push(`Calendar update ${idx + 1}: Invalid date`);
    }
  });

  // Check for empty required fields
  if (!summary.pro_dad_insight || summary.pro_dad_insight.trim() === '') {
    warnings.push('Pro Dad Insight is empty');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

**Integration**:
```typescript
// In summaryQueries.ts after AI analysis
const summary = await analyzeInbox(aiInput, aiProvider);

// VALIDATE before rendering
const validation = validateSchoolSummary(summary, emails.length);

if (!validation.valid) {
  fastify.log.error('AI summary validation failed', {
    errors: validation.errors,
    warnings: validation.warnings,
  });
  throw new Error(`AI generated invalid summary: ${validation.errors.join(', ')}`);
}

if (validation.warnings.length > 0) {
  fastify.log.warn('AI summary has warnings', validation.warnings);
}
```

**Estimated Time**: 2 hours
**Priority**: **P1 - High Priority**

---

### Phase 3: Improve Prompt Precision (Medium Priority)

**Goal**: Reduce ambiguity and improve consistency

**Specific Improvements**:

1. **Explicit Email Count Instruction**:
   ```
   CRITICAL RULE: You will receive exactly ${input.emailCount} emails.
   You MUST report email_analysis.total_received = ${input.emailCount}.
   Do NOT make up data. Do NOT assume data you didn't receive.
   ```

2. **Define "Minimal Body Text" Threshold**:
   ```
   Flag for attachments_requiring_review if:
   - Email has 1+ attachments AND
   - Body text is less than 100 characters (excluding signatures) AND
   - Email is from a school domain
   ```

3. **Strict Empty Value Rules**:
   ```
   If no data found for a section:
   - financials: [] (empty array)
   - kit_list.tomorrow: [] (empty array)
   - kit_list.upcoming: [] (empty array)
   - attachments_requiring_review: [] (empty array)
   - calendar_updates: [] (empty array)

   NEVER use null, undefined, or placeholder text like "No updates"
   ```

4. **Examples Section**:
   Add 2-3 example inputs/outputs to the prompt to show correct behavior

**Estimated Time**: 1.5 hours
**Priority**: **P1 - High Priority**

---

### Phase 4: Add Response Schema Enforcement (Medium Priority)

**Goal**: Use structured outputs to enforce schema

**Implementation**:

1. **For OpenAI**: Use `response_format` with JSON Schema (available in GPT-4o)
   ```typescript
   const response = await openai.chat.completions.create({
     model: 'gpt-4o',
     messages: [...],
     response_format: {
       type: 'json_schema',
       json_schema: {
         name: 'school_summary',
         schema: SchoolSummaryJsonSchema, // Generated from TypeScript type
         strict: true
       }
     }
   });
   ```

2. **For Anthropic**: Continue using prompt-based JSON + validation

3. **Fallback**: If parsing fails, retry once with error feedback

**Estimated Time**: 2 hours
**Priority**: **P2 - Medium Priority**

---

### Phase 5: Consistent Section Rendering (Medium Priority)

**Goal**: Sections always appear in same order, with consistent "No items" messaging

**Current Problems**:
- Sections conditionally rendered with `${section ? html : ''}`
- User doesn't know if section is missing because no data or AI error

**Solution - Always Show Section Headers**:

```typescript
// BAD (current):
const financialsHtml = summary.financials.length > 0 ? `
  <div class="section">
    <h2>💳 Payments Due</h2>
    ...
  </div>
` : '';

// GOOD (proposed):
const financialsHtml = `
  <div class="section">
    <h2>💳 Payments Due</h2>
    ${summary.financials.length > 0
      ? summary.financials.map(...).join('')
      : '<p style="color: #999; font-style: italic;">No payments due</p>'
    }
  </div>
`;
```

**Benefits**:
- User always sees all sections
- Clear when "no data" vs "section missing"
- Easier to spot AI errors

**Estimated Time**: 1 hour
**Priority**: **P2 - Medium Priority**

---

### Phase 6: Add Summary Metrics Dashboard (Low Priority)

**Goal**: Track AI performance over time

**Metrics to Track** (in database):
```typescript
interface SummaryMetrics {
  id: number;
  summary_id: number;
  ai_provider: 'openai' | 'anthropic';

  // Input stats
  emails_sent_to_ai: number;

  // Output stats
  emails_reported_by_ai: number;
  signal_count: number;
  noise_count: number;

  // Validation
  validation_passed: boolean;
  validation_errors: string[];
  validation_warnings: string[];

  // Timing
  ai_response_time_ms: number;

  created_at: Date;
}
```

**Use Cases**:
- Identify when AI is hallucinating
- Compare OpenAI vs Anthropic accuracy
- Debug email count mismatches

**Estimated Time**: 3 hours
**Priority**: **P3 - Nice to Have**

---

## 🎯 Recommended Implementation Order

### Week 1 (Critical)
1. ✅ **Phase 1**: Remove WhatsApp (30 min) - **DO FIRST**
2. ✅ **Phase 2**: Add data validation (2 hours)
3. ✅ **Phase 3**: Improve prompt precision (1.5 hours)

### Week 2 (Important)
4. **Phase 5**: Consistent section rendering (1 hour)
5. **Phase 4**: Schema enforcement (2 hours)

### Future (Optional)
6. **Phase 6**: Metrics dashboard (3 hours)

---

## 📊 Expected Outcomes

### After Phase 1-3:
- ✅ Zero hallucinated data (WhatsApp removed)
- ✅ Email counts always match (validation catches errors)
- ✅ Invalid dates/URLs caught before display
- ✅ More consistent AI responses (clearer prompt)

### After Phase 4-5:
- ✅ JSON schema enforcement reduces parsing errors
- ✅ Users always see all sections (even if empty)
- ✅ Clearer "no data" vs "error" states

### After Phase 6:
- ✅ Can track AI performance
- ✅ Can identify patterns in failures
- ✅ Data-driven decisions on OpenAI vs Anthropic

---

## ⚠️ Risk Mitigation

### Risk: Validation Too Strict
**Mitigation**: Start with errors for critical issues (count mismatch), warnings for minor issues (empty insight)

### Risk: AI Fails Validation Frequently
**Mitigation**: Log failures, implement retry with error feedback to AI

### Risk: Performance Impact
**Mitigation**: Validation is < 10ms, schema enforcement adds ~100ms (acceptable)

---

## 🔄 Testing Strategy

### For Each Phase:

1. **Unit Tests**:
   - Test validator with good/bad summaries
   - Test schema parsing edge cases

2. **Integration Tests**:
   - Run with 0 emails (should get empty valid summary)
   - Run with 1 email (counts must match)
   - Run with 100 emails (performance check)

3. **Manual Tests**:
   - Last 7 days of real emails
   - Last 30 days (higher volume)
   - Edge case: All emails are noise

4. **Comparison Tests**:
   - Same emails through OpenAI and Anthropic
   - Compare consistency

---

## 📝 Notes

- Keep original InboxSummary format for backward compatibility
- Add feature flag for WhatsApp when ready
- Consider adding user feedback mechanism ("Was this summary accurate?")
- Future: Let user configure which sections to include

---

## Approval Needed

Please review and approve phases to proceed. Recommend starting with Phase 1 immediately to stop hallucination.
