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
submission form's private field, never here.

## What's simulated vs. real

Everything you do with this account is **real**: real Gemini calls, real
rendering, real cost incurred. Nothing is mocked or faked to look good for
judges. The only thing "prepared" in advance is that this account exists
and is unlocked (no payment wall, no beta-invite gate) — beyond that,
you're generating actual new videos live.

## Suggested 3-minute path

1. **Log in** at forgevid.com → you land on `/dashboard`.
2. Go to **AI Studio** (`/dashboard/ai`). Paste any real website URL (a
   product page, a business homepage — try your own company's site, or
   `https://www.forgevid.com` itself). ForgeVid reads the page and drafts a
   brief from its actual content — nothing invented.
3. Click **Generate Video**. This is a live Gemini call (script, hook, and
   scene plan), followed by real rendering (stock/site footage + AI
   voiceover + word-timed captions). Expect ~1-2 minutes.
4. Switch the language to Spanish and generate again (or use `--lang both`
   if testing via the CLI tools) to see the same content narrated in
   natural Spanish, not a subtitle translation.
5. Visit **Ad Studio** (`/dashboard/ad-studio`) → generate a hook/CTA
   matrix for a campaign, mark a variant as a winner, enter a ROAS value.
   This is the closed-loop experiment tracking: every variant records
   which hook/CTA/aspect ratio was tried and what won.
6. Visit **Templates** (`/dashboard/templates`) to see the reusable
   template library a business would build on for repeat content.

## Known limitations (stated plainly, not hidden)

- Rendering takes real wall-clock time (video encoding isn't instant) —
  if it feels slow, that's ffmpeg actually working, not a stall.
- Stock footage quality depends on Pexels' catalog for the query terms
  Gemini picks; a very niche topic may get generic B-roll.
- This account has no video history pre-loaded — you're seeing the
  product cold, the same way a new customer does on day one.

## Support

If anything blocks you, contact [your name / email] directly — response
same day during the judging period.
