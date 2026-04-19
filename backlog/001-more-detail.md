# 001 — Progressive Detail for Summary Items

## User need
When reading the daily inbox summary, the user occasionally wants to go beyond the top-line item and explore more detail — without being overwhelmed. Detail should be accessible in discrete, low-cognitive-effort steps, mobile-first, and clearly navigable back to source.

## Scope
Applies to every **todo** and **event** rendered in the summary email.

## Levels of detail
- **L1 — Summary bullet (existing)**: item title + when, inside the summary email.
- **L2 — Item detail page (new)**: mobile-first authenticated web page, one per item. Contents:
  - Title, when, child/tag
  - 1–2 sentence AI-written context
  - Source block: sender, subject, received date (acts as a breadcrumb to L3, always visible)
  - Related items extracted from the same source email
  - Action buttons: Done / Remove (login required)
  - Link to L3
- **L3 — Original email view (new)**: full email body rendered as sanitised, mobile-styled HTML. Extracted attachment text (already stored in `attachment_content`) rendered inline as its own section. Original attachment files listed with links to view/download.

## Access & shareability (hybrid)
- L1 email contains a per-item tokenised link (same 7-day pattern as existing action tokens).
- Read-only L2 and L3 accessible via token → forwardable.
- Mutating actions (Done / Remove) require a logged-in session.

## UX principles
Mobile-first, progressive disclosure, persistent breadcrumb back to email source at every level, no dense walls of text.

## Out of scope
- Aggregated "view all" overview pages
- Inline expansion inside the email client
- Attachment re-extraction or re-parsing
