# ForgeVid Growth Operator — Implementation Audit

Prepared 2026-07-25 from `xprize-launch`. An item is “implemented” only when
the repository contains an enforceable backend path and, where appropriate, a
customer/admin surface. External account or organizer actions are listed
separately and are not misrepresented as code completion.

## Implemented

- Structured Gemini Growth Operator decisions grounded only in persisted
  inventory and measured campaign evidence.
- Decision-to-campaign generation, bilingual variants, approval inbox,
  immutable revision events, rights confirmation, selective regeneration,
  bulk review and approved-revision-only public links.
- Hook/CTA/aspect experiments, honest sample thresholds, directional versus
  confirmed labels and measured results fed into later decisions.
- Creative links and QR codes, lead capture, downstream conversions, CSV/CRM
  import, attributed revenue, CPL, spend and customer impact ledger.
- Configurable time-saved/agency-cost methodology, append-only SHA-256 evidence
  chain, CSV/JSON/PDF judge package, guided judge tour and deterministic reset.
- Explicitly opted-in scheduled Growth Operator recommendations. ForgeVid never
  publishes, posts or contacts prospects autonomously.
- Ten persisted account languages certified through authenticated Playwright
  workflows; translated Growth recommendations, approvals and impact headings.
- Gemini/OpenAI, ElevenLabs, Pexels and HeyGen live provider certification;
  provider-specific circuit breakers, BullMQ retry retention, tenant-scoped
  dead-letter review and manual replay/resolve.
- Saved authorized MLS/CRM/DMS/catalogue sources with AES-GCM encrypted
  credentials, JSON field mappings, daily/weekly imports, atomic schedule
  claims, per-run counts and row-safe error archives.
- Asset-level authorization provenance for feed, URL and uploaded photos,
  including authorization basis, source, authorizer, expiry and revocation.
- Customer-configurable opportunity weights, seasonal months and a documented
  “priced inventory aged 30+ days” revenue-at-risk proxy that never invents a
  revenue amount.
- Stripe-backed coupon codes separate from referrals, limits/expiry,
  idempotent webhook redemption records and customer coupon entry at checkout.
- Customer campaign domains with approved-creative ownership checks, DNS TXT
  verification and host-root routing to the exact approved creative.
- Referral codes, activation/follow-up lifecycle emails, testimonial consent,
  subscriptions, one-time credits, signed/idempotent Stripe webhooks, operating
  costs, revenue evidence and admin exports.

## Certification evidence

- TypeScript: `npm run type-check`
- Jest: 42 suites / 238 tests passed
- Production build: `npm run build`
- Authenticated browser E2E: 4 scenarios passed, including registration,
  authenticated product surfaces, admin/SSO and all ten account languages
- Live providers: all five configured providers passed; the full prompt →
  planning → stock media → narration → captions → FFmpeg render passed
- Compliance scanner confirms no autonomous social publishing or prospect
  messaging integrations.

## External actions still required

- The hackathon organizer—not code—must determine eligibility of the disclosed
  pre-hackathon work. The repository contains no `PROVENANCE.md`; the accurate
  disclosure and timeline drafts remain intentionally uncommitted pending the
  owner’s decision to submit them.
- Each customer must publish the displayed TXT record and attach its verified
  hostname to the ForgeVid Railway service before DNS can route public traffic.
- A Railway cron must call `/api/cron/inventory-sources` with `CRON_SECRET`;
  the route, schedule claims and import runner are implemented.
