# 002 — Blog-style Source Email (L3)

Refinement of 001 (progressive detail). Targets the L3 "original email" view only — no change to the daily summary email or to L2.

## User need
Reading a raw email body on L3 is a poor experience: plain-text emails are hard-wrapped at ~70 chars, often contain long quoted reply chains, and the page currently also dumps the full extracted attachment text. The user wants L3 to read like a blog post — comfortable typography, reflowed prose, noise trimmed — so the source email can be skimmed or read without friction.

## Scope
- `GET /view/:token/email/:emailId` only.
- Driven by the existing `StoredEmail.body_text` — no changes to ingestion, no new LLM calls.

## Changes

### 1. Remove the extracted-attachment-text block
- The "Attachment text (extracted)" card on L3 is removed entirely.
- Retain the list of attachment **files** (download links) unchanged.

### 2. Reflow the body as readable prose
Replace the current `\n → <br>` behaviour with a pipeline that treats the body as unstructured prose:

- **Unwrap soft-wraps**: any single `\n` inside a paragraph becomes a space, so lines reflow to the container width. Blank lines (`\n\n+`) still start new paragraphs.
- **Preserve list items**: a line is kept on its own (not merged into the previous paragraph) if it starts with:
  - `-`, `*`, or `•` followed by a space (bullet list)
  - a digit followed by `.` or `)` and a space (numbered list, e.g. `1. ` or `1) `)
  Consecutive list lines render as an actual `<ul>` / `<ol>` where possible; otherwise each stays as its own paragraph-like line.
- **Strip quoted replies**: remove lines prefixed with `>` (any depth) and the "On <date>, <person> wrote:" header immediately preceding them. Leave signatures, legal footers, and unsubscribe blocks alone.
- **Keep** the existing URL linkification and HTML-escaping guarantees from `renderEmailBody`.

### 3. Blog-style typography
- Keep the current font stack (Plus Jakarta Sans body, Fraunces headings) — no font change.
- Apply to the body block on L3:
  - Body size ~18–20px
  - Line-height ~1.7
  - Narrower column (~640px max) even on wider viewports
  - Generous paragraph spacing (roomier than the current 12px bottom margin)
  - Subtle link underline
- Other L3 sections (From / Subject / Received header, attachment list) stay as-is.

## Implementation notes
- Extend `src/utils/renderEmailBody.ts` (or introduce a sibling `renderEmailBodyProse` if the old plain renderer is still needed elsewhere — `git grep renderEmailBody` first).
- Add targeted unit tests for: unwrapping, bullet preservation, numbered-list preservation, `>`-prefixed line stripping, and `On … wrote:` header stripping.
- Typography lives in the L3-specific template; don't bleed blog styles into L2 or the email template.

## Out of scope
- Signature / corporate footer stripping (heuristic, over-trims — defer).
- Re-parsing HTML email bodies (we still only have `body_text`).
- Changes to L2 or the daily summary email layout.
- Attachment ingestion or storage changes.

## Known item to verify (not this ticket)
Local click-through on attachment download links 404s after a prod-clone. Likely cause: `cloneUserData.ts` copies the `email_attachments` rows but not the files from `data/attachments/`. Verify by checking that directory locally; if files are present, open a separate bug.
