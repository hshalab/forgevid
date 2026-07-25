# ForgeVid Growth Operator — Implementation Audit

Prepared 2026-07-25 from the current `xprize-launch` codebase. “Partial” means
real code exists, but at least one acceptance criterion from the full backlog is
not yet satisfied. This file does not treat a route name or mock UI as complete.

## Implemented

- Working video pipeline, persisted videos/scenes, editing, captions, voices,
  aspect ratios, branding, media upload, quotas and failure handling.
- Authorized JSON/XML/CSV feed ingestion plus manual/screenshot workflows.
- Inventory persistence, snapshots, removal detection and deterministic
  opportunity scoring.
- Automotive, real-estate and e-commerce batch workflows, including bilingual
  generation on the shared batch path.
- Ad variant generation, hook/CTA experiments, winner marking and ROAS entry.
- Public creative landing pages and lead capture.
- ForgeVid outbound Lead model with arms-length/related-party revenue split.
- Referral codes, activation/follow-up lifecycle emails and testimonial consent.
- Operating-cost and marketing-spend ledger.
- Hackathon evidence dashboard and CSV export.
- Stripe subscriptions, one-time credits, signed webhooks, idempotent credit
  grants, subscription revenue, refund reconciliation and cancellation linkage.
- Judge account seed and written testing instructions.
- Automated prohibition on autonomous social publishing and prospect messaging.
- Campaign approval inbox with rights confirmation, owner isolation, review
  notes, approve/reject/request-changes actions and revision-aware invalidation.
- Public campaign links are available only for the exact approved revision.
- Structured Gemini Growth Operator decisions grounded in persisted inventory
  evidence, with EN/ES language choice, aspect, audience, sales angle, template,
  voice, CTA, next experiment and confidence.
- Gemini decisions are stored as auditable `AIGeneration/GROWTH_DECISION`
  records with prompt, structured result, status and token usage.

## Partially implemented

| Area | Existing implementation | Remaining work |
|---|---|---|
| Provenance | Preserved October branch and accurate disclosure draft | Reconcile/delete inaccurate `PROVENANCE.md`; obtain organizer determination |
| Content authorization | Feed/manual confirmation, media validation, approval rights checkbox | Persist source/authorization per inventory asset and expiration/revocation |
| Inventory onboarding | Feed URL, paste data, single listing, screenshots | Saved feed credentials, field-mapping UI, scheduled imports and error archive |
| Opportunity scoring | Aging, recent-video, new-arrival and price-text change | Per-business weights, seasonal signals and documented revenue-at-risk methodology |
| AI decision engine | Structured Gemini decision and audit record | Turn an approved decision into a campaign; feed results into the next decision |
| Campaign experiments | Hook/CTA/aspect variants, winner and ROAS | Consistent windows, sample thresholds and directional-vs-confirmed labels |
| Approval workflow | Enforced rights/revision/public-link gate | Separate immutable Approval records, revision diff, selective regeneration and bulk review |
| Attribution | Creative ID, landing page, views and lead capture | QR generation, downstream conversion/revenue events and CRM imports |
| Customer analytics | Usage, video analytics, ROAS and evidence metrics | Unified revenue/CPL dashboard and documented time/agency-cost savings |
| Evidence ledger | Database metrics, costs, consents and CSV | Append-only evidence records, hashes, supersession records and PDF export |
| Judge mode | Seeded Pro account and written three-minute path | Guided tour, deterministic reset, reserved quota and clean demo analytics |
| Localization | Ten locale key coverage and multilingual narration | Authenticated browser E2E certification and translated new Growth UI |
| Reliability | BullMQ retries, health checks, circuit-breaker utility and provider checks | Wire breakers to providers, dead-letter review and event replay |

## Not implemented

- Scheduled daily Growth Operator execution and opt-in notification delivery.
- Full closed-loop learning using statistically honest campaign results.
- Campaign QR-code generation.
- CRM conversion imports and a customer-facing conversion/revenue ledger.
- Configurable time-saved and agency-cost-saved methodology.
- Cryptographically hashed append-only evidence package and judge PDF.
- In-app judge tour/reset controls.
- Complete authenticated supported-language browser certification.
- Coupon codes separate from the existing referral system.
- Customer-owned campaign domains.

## Ordered implementation path

1. Connect the Gemini decision to campaign creation and the approval inbox.
2. Add customer conversion/revenue events and the unified impact dashboard.
3. Feed measured results into the next Gemini decision with honest thresholds.
4. Add QR codes and CRM/CSV conversion import.
5. Add scheduled recommendations with explicit opt-in.
6. Finish judge tour/reset and evidence PDF/hash package.
7. Run authenticated localization E2E certification.
8. Complete provider circuit-breaker/dead-letter/replay operations.

