# Judge testing instructions

## Access

- URL: https://www.forgevid.com
- Email: `judge@forgevid.com`
- Password: **provided separately, in the non-public "testing instructions"
  field of the Devpost/XPRIZE submission form — never in this repo.** This
  repo is public; a credential committed here would be live on the open
  internet forever, usable by anyone who finds it, not just judges.
- Browser: any current Chrome/Edge/Firefox/Safari. No install required.

This is a real account on the real production app (Pro plan, active, seeded
by `scripts/seed-judge-demo.ts` — not a separate sandboxed environment), so
you're testing exactly what a paying customer experiences. **It is a normal
user account, not an admin account** — it cannot see other customers' data.
Financial/evidence numbers (revenue, costs, testimonials) are provided
separately as a static export in the written submission, not via live
login — the admin dashboard shows real customers' names, emails, and Gemini
prompts, which isn't appropriate to expose to an external reviewer even for
judging purposes.

To (re)set the password before submitting, run once with a password you
choose: `JUDGE_DEMO_PASSWORD='...' DATABASE_URL=<railway-url> npx tsx
scripts/seed-judge-demo.ts` — then paste that same password into the
submission form's private field, never here. The seed also preloads three
deterministic sample inventory items (an SUV, a home listing, a product
SKU) so the Growth Operator has something real to reason about on first
login.

## What's simulated vs. real

Everything you do with this account is **real**: real Gemini calls, real
rendering, real cost incurred. Nothing is mocked or faked to look good for
judges. Two things are prepared in advance: the account exists and is
unlocked (no payment wall), and three clearly-labeled demo inventory items
("ForgeVid Demo SUV" etc.) are preloaded so the AI-operated business loop
is demonstrable without waiting on a live dealer feed. All video
generation, Gemini decisions, approvals, and analytics you trigger happen
live, from zero.

## Guided tour (recommended): the AI-operated business loop

Log in and open **Judge Tour** in the sidebar (`/dashboard/judge` — the
link is only shown to this account). It walks the four-step loop:

1. **Growth recommendations** (`/dashboard/recommendations`) — the three
   demo inventory items, scored by the configurable opportunity model, and
   a **"Get Gemini decision"** button: a live, structured Gemini call that
   picks which item to campaign on and why (audience, hooks, CTA,
   languages), grounded only in the persisted inventory and any measured
   prior results — with its rationale shown inline.
2. **Generate the campaign** — one click renders the decision's bilingual
   (EN/ES) creative variants. Spanish is generated natively by the
   pipeline, not subtitle-translated. Expect ~1–2 minutes per video; that
   is real ffmpeg rendering, not a stall.
3. **Approvals** (`/dashboard/approvals`) — nothing goes public
   autonomously. Approve a creative (rights confirmation required) to
   activate its public landing page and QR code; every approval event is
   recorded in an append-only, hash-linked evidence chain.
4. **Impact** (`/dashboard/analytics`) — real per-account queries (leads,
   conversions, cost-per-lead, attributed revenue, time saved). This
   starts near zero and populates as your session generates activity —
   deliberately: it computes from real rows, never mock data.

The **"Reset demo workspace"** button on the tour page restores the
account to exactly the three starting inventory items at any time (it
deletes only this demo account's data — production evidence is untouched,
and the reset itself is logged to the evidence chain).

## Alternate 3-minute path: the core video product

1. Go to **AI Studio** (`/dashboard/ai`). Paste any real website URL —
   ForgeVid reads the page and drafts a grounded brief from its actual
   content, nothing invented. Click **Generate Video** (live Gemini script
   + real render with stock/site footage, AI voiceover, word-timed
   captions).
2. Switch the narration language to Spanish and generate again to hear
   native Spanish narration.
3. Visit **Ad Studio** (`/dashboard/ad-studio`) for the hook/CTA
   experiment matrix, and **Templates** (`/dashboard/templates`) for the
   reusable library.
4. Also in AI Studio: the **Frontier AI** tab is the opt-in, credit-billed
   text-to-video path (Runway / Google Veo / ByteDance Seedance / Kuaishou
   Kling through one integration) — distinct from the free stock-footage
   assembler.

## Known limitations (stated plainly, not hidden)

- Rendering takes real wall-clock time (video encoding isn't instant) —
  if it feels slow, that's ffmpeg actually working, not a stall.
- Stock footage quality depends on Pexels' catalog for the query terms
  Gemini picks; a very niche topic may get generic B-roll.
- Analytics/impact figures start near zero on a fresh reset — they compute
  from your session's real activity, because pre-faking them would defeat
  the point of an evidence-first product.
- The Frontier AI tab requires provider credits on the Runway account; if
  generation errors with a credit message, that path is temporarily
  unfunded (the free stock-footage path is unaffected).

## Support

If anything blocks you, contact [your name / email] directly — response
same day during the judging period.
