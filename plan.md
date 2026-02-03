# Plan: Merge both inbox scans into a single pass

## Problem
The "Search newsletters & updates" button requires a second user action. School newsletters often live in `category:updates`, so they're missed in the initial `category:primary` scan.

## Change
Remove the two-pass approach entirely. Do a single `fetchAllSenders` call with **no category filter** — just the existing noise/spam/trash/sent exclusions. This pulls senders from both primary and updates in one go. The AI ranker already handles sorting noise to the bottom.

### Files to change

1. **`src/routes/childProfileRoutes.ts`** — Remove `broadSearch` body param and `categoryFilter` logic. Call `fetchAllSenders(auth, 'last30days', '', 500)` with no category filter.

2. **`src/routes/authRoutes.ts`** (onboarding JS) — Remove `hasBroadSearched`, `primarySenderEmails`, the broad search merge logic in `scanInbox()`, and the "Search newsletters" pagination button. `scanInbox()` becomes a single call with no parameter.

### What stays the same
- `fetchAllSenders` in `inboxFetcher.ts` — no changes needed, it already supports empty `extraQuery`
- `senderRelevanceRanker.ts` — no changes
- The AI ranking + sectioned UX handles the bigger list naturally (low-relevance senders collapse into "Other")

### Risk
- Slightly more senders returned (maybe 30–60 vs 20–40), but the collapsed "Other" section handles this well
- Gmail API usage increases slightly (one bigger query vs two smaller), but stays within the 500 message cap
