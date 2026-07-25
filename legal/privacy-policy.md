# ForgeVid — Privacy Policy

> **DRAFT — attorney review required.** Industry-standard template grounded in how ForgeVid operates.
> **Not legal advice.** Have counsel confirm your CCPA/CPRA and GDPR obligations, appoint an EU/UK
> representative if you have EU/UK users, and finalize the sub-processor list. Replace every `[BRACKET]`.

**Last updated: [DATE]**

**Kryst Investments LLC** ("**ForgeVid**," "**we**") provides an AI video-generation service. This Policy
explains what personal data we collect, how we use and share it, and your rights. For personal data of
EU/UK individuals, ForgeVid is the "**controller**" for its own account/marketing data and a
"**processor**"/"**service provider**" for the Customer Content you submit.

## 1. Data we collect
- **Account & profile:** name, email, password (hashed), organization, role.
- **Billing:** subscription plan and history. **Card payments are processed by Stripe; we do not
  receive or store full card numbers.**
- **Customer Content you submit:** prompts, uploaded images/audio, feed URLs and the listing/vehicle/
  product data they return, and the videos you generate. This may include personal data of third
  parties that *you* choose to include (e.g., people in photos).
- **Usage & device data:** log data, IP address, browser/device info, pages and features used,
  timestamps, and cookies/similar technologies.
- **Communications:** support messages and emails.
We do **not** intentionally collect special-category/sensitive data, and you should not submit it
unless necessary and lawful.

## 2. How we use data
To (a) provide, maintain, and secure the Service and generate your videos; (b) process payments and
manage subscriptions; (c) provide support; (d) send service and, where permitted, marketing emails
(you can opt out); (e) monitor, debug, prevent abuse/fraud, and enforce our Terms and Acceptable Use
Policy; and (f) comply with law. **Legal bases (GDPR):** performance of contract, our legitimate
interests (security, product improvement), consent (where required, e.g., marketing/cookies), and
legal obligation.

## 3. AI processing & training
To generate videos we transmit relevant inputs to third-party AI providers (Section 5). **We do not
sell your personal data, and we do not use your Customer Content to train our own or third parties'
foundation models except as needed to provide the Service** [confirm this reflects your and each
provider's actual configuration — e.g., OpenAI API data is not used for training by default].

## 4. How we share data
We share personal data only with: (a) **service providers/sub-processors** (Section 5) under contract;
(b) **at your direction** (e.g., publishing your videos); (c) for **legal reasons** (law, legal
process, safety, or to protect rights); and (d) in a **business transfer** (merger, acquisition,
financing), subject to this Policy. **We do not sell or "share" (as defined by the CCPA/CPRA) your
personal data for cross-context behavioral advertising.**

## 5. Sub-processors
We use vetted providers to run the Service. Current sub-processors (representative — keep this list
current and post it publicly):

| Provider | Purpose | Data |
|---|---|---|
| Vercel / [hosting] | App hosting | Account, usage, logs |
| [Render / worker host] | Video rendering | Customer Content, Output |
| [Managed Postgres — Neon/Supabase] | Database | Account, subscription, metadata |
| [Managed Redis — Upstash] | Job queue | Job metadata |
| Cloudinary | Video/image storage & delivery | Media, Output |
| Stripe | Payments & subscriptions | Billing/contact (card data held by Stripe) |
| OpenAI | Script/scene generation | Prompt/feed text |
| ElevenLabs | AI voice synthesis | Narration text |
| [HeyGen / avatar provider] | AI avatars (if used) | Script; likeness inputs |
| Pexels | Stock media | Search terms |
| [Email/SMTP — Resend/Postmark] | Transactional email | Email address, message |
| [Sentry / analytics] | Error & product analytics | Usage, device, limited identifiers |

Each is bound by GDPR Art. 28 / CCPA service-provider terms (purpose limitation, no independent use,
security, sub-processor flow-down). A current list is available at **[URL]**; we give notice of
material changes.

## 6. International transfers
We are US-based and may process data in the US and other countries. For transfers of EU/UK/Swiss data,
we rely on **Standard Contractual Clauses** (and the UK Addendum) or another lawful mechanism.

## 7. Retention
We keep personal data for as long as your account is active and as needed to provide the Service, then
for a limited period to meet **legal, tax, security, and dispute-defense** needs, after which we delete
or anonymize it. You can request deletion (Section 8). We may retain a minimal audit record of key
actions and consents.

## 8. Your rights
**California (CCPA/CPRA):** you may request to **know/access, delete, and correct** your personal data,
and to **limit** use of sensitive data; we honor **opt-out of sale/sharing** (we do not sell/share);
and we will not discriminate for exercising rights. **EEA/UK (GDPR):** you have rights of **access,
rectification, erasure, restriction, portability, objection**, and to **withdraw consent** and **lodge
a complaint** with your supervisory authority. To exercise any right, contact **[privacy@forgevid.com]**;
we verify identity and respond within the legally required time. **Authorized agents** may submit
requests on your behalf. If you are a data subject whose data was submitted by a Customer, we will
refer your request to that Customer (the controller).

## 9. Cookies
We use necessary cookies to run the Service and, with consent where required, analytics cookies. You
can control cookies via your browser and our cookie banner **[if used]**.

## 10. Security
We use administrative, technical, and physical safeguards (encryption in transit, access controls,
hashed passwords, request validation). **No system is perfectly secure**; we cannot guarantee absolute
security. We will notify affected users and regulators of a personal-data breach as required by law.

## 11. Children
The Service is not directed to children under **16**, and we do not knowingly collect their data. If we
learn we have, we will delete it.

## 12. Voice & likeness
If a feature ever creates a voice or avatar from **your own** biometric inputs, we will obtain the
consent required by applicable law (e.g., Illinois BIPA) before doing so and will not use it beyond the
stated purpose. You must not submit other people's voice/likeness without their authorization (see the
Acceptable Use Policy).

## 13. Changes
We may update this Policy; we will post the new version with a new date and, for material changes, give
notice. 

## 14. Contact
**Kryst Investments LLC · [address]**
Privacy requests: **[privacy@forgevid.com]** · EU/UK representative: **[if applicable]** · DPO: **[if applicable]**
