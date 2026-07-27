> **SUPERSEDED 2026-07-27 — DO NOT SEND THIS DOCUMENT.** Its central claim
> ("the current repo has no commit before 2026-07-07... commits before
> 2026-05-19: 0") is **factually wrong**: `origin/master` — GitHub's default
> branch for this repo — is commit `205e2236f` dated 2025-10-21, a
> 1,459-file, explicitly `"name": "forgevid"`-branded snapshot with Prisma
> migrations dated back to 2025-09-22. That branch was reachable the whole
> time this report was written; it was simply not checked. Verified directly
> against `git for-each-ref` / `git show` / `git ls-tree`, not re-derived
> from this file. Use `evidence/XPRIZE-ELIGIBILITY-DISCLOSURE.md` and
> `evidence/XPRIZE-ELIGIBILITY-EMAIL.txt` instead — those correctly disclose
> the October 2025 predecessor. Kept here only as an audit trail of the
> mistake, not as a source of truth.

# ForgeVid — Provenance Report

Prepared 2026-07-25 for XPRIZE hackathon eligibility review (COMP-001).
Sources: `git log` on the working repo, file mtimes, `TODO.md` progress log,
Railway project state. Nothing here is inferred beyond what those sources show.

## Bottom line

**Every commit in the recoverable git history — 157 commits — is dated
2026-07-07 or later.** The current repo has no commit before that date. The
project's pre-existing code was, by its own in-repo audit trail, a
non-functional scaffold; the working, revenue-generating product was built
from 2026-07-07 onward. If the hackathon's eligible window opens on or before
2026-07-07, ForgeVid's entire verifiable build history sits inside it.

## What the git history actually shows

| Fact | Evidence |
|---|---|
| Earliest commit | `3094ce6` 2026-07-07 — "chore: establish standalone ForgeVid repo outside OneDrive" |
| Total commits | 157 |
| Commits before 2026-05-19 | **0** |
| Commits after 2026-05-19 | 157 (100%) |
| Most recent | 2026-07-25 |

## Why history doesn't go back further (the honest gap)

The project previously lived at
`C:\Users\yanp0\OneDrive\Documentos\proyectos\forgevid`. OneDrive's
file-placeholder sync corrupted the working tree there: per `TODO.md`'s own
2026-07-07 entry, *"654 files were unretrievable OneDrive placeholders —
reconstructed from git history"*, and a `.git` directory remains in that
folder today but is **empty** (0 objects) — confirmed by direct inspection,
not recoverable. There is no way to produce a clean pre-2026-07-07 commit
log; none is claimed here.

What we can say about the pre-existing code, from the in-repo audit itself
(`TODO.md`, 2026-07-07 entry):

- `npm run type-check` failed with **701 errors** — the project did not
  compile.
- The admin dashboard rendered fabricated data to any visitor (invented
  users, invented `$89,432` revenue) — since replaced with real
  database-backed queries (`app/admin/page.tsx`).
- `README.md` still carries placeholder marketing copy from that scaffold
  ("AR/VR Editing Suite," "Blockchain Provenance & NFT Monetization,"
  "Quantum-Inspired Compression") — never-built, never-real features that
  predate any actual product decision and should not appear in submission
  materials.

**Classification:** the pre-existing artifact was generic Next.js/Prisma
SaaS boilerplate plus AI-scaffold noise — not a functioning product. It
contained no working video pipeline, no working payments, no working
deploy. Every one of those was built inside the verifiable window.

## What was built inside the window (selected, dated)

| Date | Change |
|---|---|
| 2026-07-07 | Repo made to compile (701 → 0 type errors); async render pipeline built |
| 2026-07-08 | First working end-to-end video build; Whisper-aligned captions |
| 2026-07-13 | Render worker made deployable; health endpoint |
| 2026-07-21 | Karaoke captions, brand font upload, presenter picture-in-picture; Railway launch config |
| 2026-07-22 | **Gemini made the LLM provider for all text completions** (scripts, hooks, chat, storyboards); provider exposed at `/api/monitoring/health` |
| 2026-07-23 | Gemini base URL made env-overridable (Vertex AI / GCP enabler); production Docker build fixed |
| 2026-07-24 | Daily self-marketing engine (bilingual EN/ES, 3 brands); word-timed karaoke fix; prospect-sample generator (personalized outbound video-in-one-command) |
| 2026-07-24–25 | 279-account outbound tracker built (dealers, realtors, e-commerce); ElevenLabs voice cloning wired in |

Business/revenue-relevant dates (from this session, verify against Stripe/DB
before citing in the submission — not re-derived here):

- Live product URL: https://www.forgevid.com
- First `ACTIVE` paid-tier subscription row: verified via SQL this session
  (owner account, princedperez@gmail.com) — **not arms-length**, must be
  excluded from judged revenue per hackathon rules.
- First outbound personalized sample sent to a genuine third party:
  Machado Auto Sales, 2026-07-24 (`outbound/dealers.csv`, status
  `SAMPLE_SENT`).
- Stripe LIVE mode: **not yet activated** as of this report — no arms-length
  revenue is collectible until it is. This is the single blocker on the
  revenue evidence the judges weight most heavily.

## What this report does NOT establish

- The exact calendar date ForgeVid-the-idea or ForgeVid-the-codebase was
  first created. No source in this environment can answer that reliably,
  and no date is asserted for it here.
- Whether 2026-07-07 falls inside or outside the official eligibility
  window — that depends on rules text this report doesn't have.

## Recommended action

Do **not** self-classify eligibility from this report alone. A draft
clarification email to the organizers is at
`evidence/ORGANIZER-CLARIFICATION-DRAFT.txt` — it states the facts above
plainly (existing pre-scaffold, non-functional; rebuild and launch inside
the window) and asks a direct yes/no question. Send it yourself; an AI
agent should not initiate outbound correspondence with a competition body
on your behalf. Keep the reply in this folder once it arrives.

## Compliance check performed alongside this report (COMP-003, partial)

Audited the current codebase for autonomous publishing or autonomous
prospect-messaging paths (`grep` across `app/`, `lib/`, `scripts/` for
social-platform posting APIs, cron/schedule triggers, and prospect-facing
email sends):

- **No code posts to Instagram/TikTok/Facebook/X APIs anywhere in the
  repo.** All social posting is manual — a human downloads the MP4 and
  posts it themselves.
- **No autonomous prospect email exists.** `emailSample()` and
  `emailClip()` (the two functions capable of sending a rendered video by
  email) always send `to:` the operator's own inbox
  (`MARKETING_EMAIL`/`--email` flag), never directly to a dealer, realtor,
  or store's address. DMs to prospects are copy-pasted by hand from the
  generated template.
- The only `cron`/`schedule` string matches in the codebase are: an unused
  stub (`DataManagement.scheduleCleanup` — logs and returns, no scheduler
  wired up), an auth-provider boot-time initializer (unrelated to
  publishing), and Spanish caption text that happened to contain
  "sincronizados." None execute anything autonomously.

This satisfies "no autonomous publication or messaging path exists" as a
present-tense fact about the current code. It is not yet backed by an
automated test (`SUB-003` asks for that) — worth adding before final
submission freeze, not before.
