# Dev Task 11.1: Restructure Email Summary - Plan

## Current Structure
1. Header with date
2. Insights section (AI-generated tips)
3. Essential section (urgent items - today/tomorrow combined)
4. For Consideration section (upcoming - rest of week, full cards)
5. Footer

## New Structure
1. **Summary of Today** - bullet point 1-line summaries
2. **Today Details** - full todos/events cards for today only
3. **For Consideration** - short bullet list of non-urgent items
4. **Calendar (for the week)** - today +7 days summary view

---

## Implementation Plan

### Step 1: Update Summary Builder - Split "today" from "tomorrow"

**File**: `src/utils/personalizedSummaryBuilder.ts`

Currently `splitByUrgency()` groups today+tomorrow as "urgent". Need to:
- Create new split function: `splitByDay()` that returns `{ today, tomorrow, upcoming }`
- Update `ChildSummary` and `FamilySummary` interfaces to have:
  - `today_todos`, `today_events`
  - `tomorrow_todos`, `tomorrow_events` (optional, for calendar section)
  - `upcoming_todos`, `upcoming_events`

### Step 2: Update Template Types

**File**: `src/templates/personalizedEmailTemplate.ts`

Update interfaces:
- `ChildSummaryWithActions` - add `today_todos`, `today_events`, etc.
- `FamilySummaryWithActions` - same
- `PersonalizedSummaryWithActions` - same

### Step 3: Create New Render Functions

**File**: `src/templates/personalizedEmailTemplate.ts`

New functions needed:

```typescript
// 1. Summary of Today - bullet points only
function renderTodaySummary(summary): string
// Returns compact bullet list: "• Pack PE kit for Ella", "• Pay £80 for trip"

// 2. Today Details - full cards for today
function renderTodayDetails(summary): string
// Returns full todo/event cards but only for items due TODAY

// 3. For Consideration - short bullet list
function renderForConsideration(summary): string
// Returns compact bullet list of upcoming items (not full cards)

// 4. Calendar Week View - 7 day summary
function renderWeekCalendar(summary): string
// Returns day-by-day summary: "Mon 20th: 2 events, 1 todo", etc.
```

### Step 4: Update Main Render Function

**File**: `src/templates/personalizedEmailTemplate.ts`

Update `renderPersonalizedEmail()` to use new sections:
```html
<div class="container">
  <header>...</header>

  ${renderTodaySummary(summary)}      <!-- NEW: Bullet points -->

  ${renderTodayDetails(summary)}      <!-- NEW: Full cards for today -->

  ${renderForConsideration(summary)}  <!-- UPDATED: Bullet list, not cards -->

  ${renderWeekCalendar(summary)}      <!-- NEW: 7-day overview -->

  <footer>...</footer>
</div>
```

### Step 5: Add CSS for New Sections

Add styles for:
- `.summary-bullets` - compact bullet list
- `.week-calendar` - calendar grid/list
- `.day-row` - individual day in calendar

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/personalizedSummaryBuilder.ts` | New `splitByDay()`, update interfaces and data structure |
| `src/templates/personalizedEmailTemplate.ts` | New render functions, update main template |

---

## Questions for Clarification

1. **"For Consideration" content**: Should this include:
   - Tomorrow's items? Or just 2+ days out?
   - Non-actionable info from emails (e.g., school newsletter updates)?
   - Currently we don't store "informational" emails separately - is this needed?

2. **Calendar week view format**: Prefer:
   - List format: "Mon 20th: PE kit, Swimming"
   - Grid format: visual calendar grid
   - Summary only: "3 events Mon, 2 events Tue..."

3. **Insights section**: Keep it, remove it, or merge into "Summary of Today"?

---

## Execution Order

1. Update summary builder with `splitByDay()`
2. Update interfaces in both files
3. Create `renderTodaySummary()` function
4. Create `renderTodayDetails()` function
5. Update `renderForConsideration()` to use bullet format
6. Create `renderWeekCalendar()` function
7. Update main `renderPersonalizedEmail()` function
8. Add CSS styles
9. Build and test
