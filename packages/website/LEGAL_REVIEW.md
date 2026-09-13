# Legal document publication review

The Privacy Policy and Terms of Service are original review drafts, not a legal
opinion or a claim that Tearleads meets every jurisdiction's requirements.
While `src/legal.ts` sets `isDraft: true`, production and ordinary static builds
render only a publication placeholder and the company's contact details, not the
draft text or summary. Full drafts are available in the local development server
(`bun run dev`) and explicitly configured staging builds, marked **not yet
effective** and carrying `noindex`. They have not been deployed as part of this
drafting task. Do not treat a successful build as approval to adopt them.

## Confirmed by the owner

- Operator: Tearleads, LLC.
- Location: Chattanooga, Tennessee, United States.
- Public privacy and legal contact: <legal@tearleads.com>.
- Sync and Sharing are available, not coming soon.
- No street mailing address was supplied; none has been invented.

## Decisions to approve before publication

Have the owner and qualified counsel review the full documents, including these
proposed terms. These are drafting choices, not existing business instructions:

- **Eligibility:** age 18 and legal capacity, including organizational authority.
- **Refunds:** no ordinary partial-period refunds, with statutory and store
  exceptions; unused prepaid service refunded if Tearleads discontinues it for
  reasons unrelated to a user's breach.
- **Liability:** the greater of US $100 or 12 months of affected-service fees,
  with exceptions for misconduct and non-excludable rights.
- **Disputes:** Tennessee law with mandatory local protections; non-exclusive
  Hamilton County jurisdiction; no mandatory arbitration or class-action waiver.
- **Changes and suspension:** reasonable notice where practicable, a review
  route, and an opportunity to export available data on discontinuation.
- **Privacy commitments:** no sale or targeted-advertising disclosure of personal
  information, no legally significant automated decisions, and the stated limits
  on diagnostics. Source inspection cannot prove all off-platform business practices.

## Operational and legal checks

1. Verify that the legal mailbox receives mail and has an owner who can handle
   requests, identity verification, authorized agents, appeals, and legal notices
   within applicable deadlines. Never request recovery phrases or private keys.
2. Set and document actual retention schedules for request logs, Sentry events,
   support mail, billing records, backups, and dormant identity/organization rows.
   Verify the deployed blob-cleanup and billing-lapse grace periods. The draft
   discloses current indefinite audit retention; counsel should assess whether
   each retained category is necessary and whether a deletion or minimization
   workflow is needed. No arbitrary deletion deadline has been promised.
3. Confirm the deployed provider inventory, regions, Sentry scrubbing settings,
   Cloudflare features, payment-provider settings, and any additional email or
   support tools. Confirm what each provider receives, retains, and uses for its
   own purposes. Code and infrastructure defaults are not a live-account audit.
4. Determine applicable jurisdictions and business thresholds, including US state
   privacy laws. If serving EEA/UK users, assess controller/processor roles,
   lawful bases, representatives, necessary processing agreements, and actual
   international-transfer safeguards. Add specific arrangements where applicable;
   the draft does not assert that transfer agreements or certifications exist.
5. Decide whether a published mailing address and jurisdiction-specific notices
   are needed. Review child/teen access and store age ratings against the proposed
   adult-only terms; a sentence in a policy is not age-assurance implementation.
6. Review whether a separate organization data-processing agreement, store-specific
   license terms, or regulated-data agreement is needed. Encryption alone does
   not establish compliance with sector-specific obligations.
7. Surface the finalized policies at identity registration and checkout, provide
   conspicuous recurring-payment disclosures, and implement/version acceptance
   where appropriate. Footer links alone do not establish contractual assent or
   recurring-payment consent. No app, API, or checkout-consent flow was changed
   here.
8. Verify Stripe and native-store cancellation and refund behavior, including
   cancellation without identity keys. Confirm billing-lapse warnings and the
   promised notice, export, and refund procedures are operationally supported.

## Publication

After approval, update the document text, set the agreed effective date in
`src/legal.ts`, and change `isDraft` to `false`. The display label is derived in
UTC. Approval enables full production rendering and removes the review notice
and document-specific `noindex`; staging remains non-indexable.
Preserve a copy of adopted versions and arrange appropriate notice to users.
Build and review both pages again, then deploy only when publication is authorized.

## Implementation evidence

| Disclosure | Repository evidence |
| --- | --- |
| Encryption, visible metadata, sharing limits | `docs/security-guarantees.md`, `docs/keying-design.md` |
| App and API diagnostics, exclusions, connection IP exposure | `docs/developer/sentry.md`, `packages/diagnostics/src/privacy.ts` |
| Session IPs and activity | `packages/api/src/routes/auth/sessions.ts`, `packages/api/src/middleware/session.ts` |
| Local identity destruction is local | `packages/app/src/providers/identity/useDestroyKey.ts` |
| Billing providers and platform responsibilities | `docs/developer/revenuecat-billing.md` |
| Billing-email cancellation | `src/pages/manage-subscription.astro`, `packages/api/src/billing/stripeCustomerEmail.ts` |
| Blob lifecycle and durable audit metadata | `docs/attachment-retention.md` |
| Lapse purge and retained organization/identity/billing records | `docs/developer/billing-lapse-recovery.md`, `docs/developer/billing-purge-recovery.md` |
| Hosting providers and primary regions | `terraform/stacks/prod/{server,postgres,storage,website}`, `ansible/playbooks/templates/etc/nginx/nginx.conf.j2` |

Paths outside this package are relative to the repository root.

## Primary guidance consulted

- Privacy notices should explain purposes, recipients, retention, rights, and
  applicable legal bases in understandable language. The ICO notes that some
  guidance is under review following legislative changes.
  [ICO: right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/).
- Retention and security practices need an information inventory and an actual
  operational policy, not just website promises.
  [FTC: protecting personal information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business).
- Online recurring billing requires review of disclosure, consent, and
  cancellation obligations independently of the Terms text.
  [FTC: Restore Online Shoppers' Confidence Act](https://www.ftc.gov/legal-library/browse/statutes/restore-online-shoppers-confidence-act).
- State privacy rights depend on the law's scope and applicability; the draft
  does not assume every business is covered.
  [California Attorney General: CCPA](https://www.oag.ca.gov/privacy/ccpa).
- General-audience services can have children's-privacy obligations when they
  acquire actual knowledge of collecting information from a child under 13.
  [FTC: COPPA frequently asked questions](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).

These sources inform review topics. They are not approval of these documents,
templates copied into them, or a substitute for jurisdiction-specific advice.
