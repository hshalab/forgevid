# ForgeVid — One-Page Development and Launch Timeline

**Prepared:** July 25, 2026  
**Project:** ForgeVid — <https://www.forgevid.com>  
**Purpose:** Request for a written eligibility determination for the Build with Gemini XPRIZE  
**Submission period:** May 19, 2026, 10:00 a.m. PDT through August 17, 2026, 1:00 p.m. PDT

## 1. Pre-existing work

The repository contains a separate historical branch, `origin/master`, with commit
`205e2236f19b949b7484a2879a8c519e47a737a2`, dated October 21, 2025 and titled
“Initial commit: AI video/image pipeline, backend, and integration.” Its snapshot
contains approximately 1,459 files, including ForgeVid-specific AI/video APIs,
dashboard and administration interfaces, authentication, Stripe scaffolding,
media/template APIs, localization, Prisma migrations, workers, tests, deployment
configuration, and extensive documentation. Database migration filenames also
indicate development activity in September and October 2025.

This predecessor is disclosed as substantial pre-existing product-specific work.
Some parts were incomplete, duplicated, mocked, or nonfunctional, but I am not
representing the entire predecessor as generic boilerplate.

## 2. Commit history around May 19, 2026

The available Git repository contains no commits between October 21, 2025 and
July 7, 2026. It therefore contains no commit immediately before, on, or immediately
after the May 19 opening date. This is an evidence gap, not proof that the project
did not exist. The July reconstruction is a separate root history; it does not erase
the October branch, which remains preserved and available for review.

## 3. Hackathon-period additions

Starting July 7, 2026, a new standalone repository history rebuilt and launched the
working product. The current lineage contains 165 commits dated July 7–25. Documented
work includes: repairing 701 TypeScript errors; building an asynchronous, scene-based
FFmpeg rendering pipeline; real provider verification; Whisper-aligned and karaoke
captions; multiple aspect ratios; voice, avatar, media, brand and editing workflows;
authorized inventory feeds and single-item imports; automotive, real-estate and
e-commerce flows; bilingual and later multilingual narration; working billing,
credits, quotas and cost tracking; Railway deployment; Gemini as the production
text-completion provider beginning July 22; creative experiments; lead attribution;
human approval/content-authorization safeguards; evidence reporting; and judge-mode
foundations.

Snapshot comparison confirms a material reconstruction: the October snapshot has
approximately 1,459 files, the July 7 reconstruction approximately 681 files, and
the comparison spans 1,577 changed paths with extensive deletion and replacement.

## 4. First production launch date

The exact first public production-launch date is **not yet conclusively established**.
The earliest Railway record currently retrievable through the linked project is
July 22, 2026 at 1:28 a.m. PDT. Git commit `45763d8` on July 21 added Railway
standalone deployment configuration specifically labeled “XPRIZE launch.” ForgeVid
is currently publicly reachable at <https://www.forgevid.com>. I will provide a more
precise launch date only if it can be verified from Railway, DNS, database, or
provider records.

## 5. Customer and revenue timeline

- July 24, 2026: the internal outbound tracker records the first personalized sample
  sent to a third-party prospect, Machado Auto Sales. This is outreach evidence, not
  evidence of a customer, sale, or earned revenue.
- The database reportedly contains an active paid-tier row associated with the owner.
  It is related-party activity and will not be reported as independent revenue.
- Independent, arms-length customer revenue is **not established by the Git or
  Railway evidence reviewed for this document**. Any future revenue claim will be
  supported by Stripe/payment records, customer identity, transaction date, amount,
  related-party classification, and customer consent where required.

## 6. Railway deployment history

The linked production project is `Forgevid`, environment `production`, service
`forgevid`, region US West. Available records begin July 22 and show frequent
deployments throughout July 22–25. Deployment
`410c624f-b1df-43fe-a6bf-c76b3c287d36` succeeded on July 25 at 10:39 a.m. PDT and
was serving production when this report was prepared. Later deployment attempts
failed while Railway retained the last successful version online. Full raw Railway
records can be provided if requested.

## 7. Eligibility question

Given the disclosed October 2025 predecessor and the substantial rebuild, Gemini
integration, production launch, business workflows, and customer-development work
performed during the submission period, may ForgeVid be submitted as an eligible
project? If so, what additional disclosure, component comparison, repository access,
or evidence should accompany the submission?

I will preserve both histories and will not delete, rewrite, squash, backdate, or
otherwise conceal the pre-existing work. I am requesting a written determination
before relying on any eligibility interpretation.

