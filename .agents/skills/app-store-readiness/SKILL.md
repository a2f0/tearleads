---
name: app-store-readiness
description: Audit and prepare iOS, Android, and web apps for release, covering platform interface guidance, accessibility, privacy disclosures, store metadata, and likely review blockers. Use for a readiness assessment or pre-submission preparation, not ordinary feature implementation.
---

# App Store Readiness

Produce an evidence-backed release decision for the requested platforms.
Treat store approval, build acceptance, automated accessibility checks, and
human usability as separate outcomes. A successful build or beta upload does
not establish readiness.

## Establish the candidate

Read the repository's instructions, release documentation, and readiness
guide (`docs/readiness.md` when present). Identify the source revision, app
IDs, version/build, supported devices and OS/browser versions, distribution
tracks, and the artifact actually tested. Map the user journeys and
applicable features: accounts, payments, user content, ads/tracking,
sensitive permissions, children, background work, local storage, and external
services. Mark irrelevant checks **N/A** with a reason.

Use the user's scope. A report-only request stays read-only.
Preparation/dogfooding can include reversible fixes and local tests. This
skill does not by itself authorize uploads, submission, publication, messages
to reviewers, changes to pricing or store declarations, or purchases. Existing
explicit authorization still applies; do not ask for it again. Do not
fabricate review contacts, privacy answers, age ratings, or product claims.

## Check the applicable platforms

Read only the references for the requested platforms:

- [iOS / iPadOS](references/ios.md): Apple review risks, HIG,
  accessibility, and submission evidence.
- [Android](references/android.md): Play policy, Material/Compose
  accessibility, release behavior, and console evidence.
- [Web](references/web.md): WCAG, browser behavior, privacy/support pages,
  and deployment evidence.

Open the current official sources linked there. Record the access date and
the exact requirement, deadline, exception, and distribution context that
affect this candidate. Do not reuse remembered target API, SDK, billing, or
regional payment rules. If a documentation page is only a JavaScript shell,
try its official linked documentation or an official text/JSON representation
before relying on it. If a source is inaccessible, mark that decision
unverified rather than silently assuming it is current. Distinguish mandatory
store policies from interface recommendations, chosen accessibility targets,
and repository conventions. Do not present a guideline preference as certain
rejection.

## Gather evidence, repair, and retest

Trace important claims from listing/policy → source and dependencies → built
artifact → runtime behavior. Run the repository's documented readiness lanes
(`docs/readiness.md`) when present against the candidate for artifact and
store-record evidence; their reports leave manual, declaration, and policy
checks unverified by design. Inspect
public links and actual store configuration when access is available; never
infer console completion from local metadata files. Keep credentials,
reviewer contact details, user records, and private diagnostics out of reports
and Git. Use local, disposable test data and dedicated devices where
available.

Exercise launch, the core task, settings, dismissal/back navigation,
background/foreground, and persistence/failure paths. Include a compact
layout, large text/zoom, light/dark modes, localization, and relevant
assistive input. For accessibility, inspect names, roles, states, reading
order, focus, adjustment actions, contrast, and target sizes. Test the
shipping configuration, including minification and extensions/widgets where
applicable. Follow the repository's validation commands; do not invent a
substitute gate.

Record reproducible failures with platform, device/configuration, affected
journey, and supporting evidence. Repair actionable issues within scope and
retest the affected paths. If fixing one finding changes data flows,
permissions, commerce, or declared capabilities, reconcile the resulting
policy/metadata impact. Escalate product decisions only when needed; keep
unrelated checks moving. Do not add accounts, analytics, permission prompts,
or generic compliance UI merely to satisfy an inapplicable checklist.

## Prepare the reviewer packet

Treat what the reviewer receives as part of the candidate. Before a first
submission, and whenever the core flow changes, the review notes answer
without being asked:

- the app's purpose and audience, the problem it solves, and why it is worth
  having over established apps in its category;
- how to reach each main feature from launch, with demo credentials, sample
  files, or a statement that none are needed;
- each external service the core features rely on (data providers,
  authentication, payments, AI), or a statement that there are none;
- regional differences in features or content, or confirmation that there are
  none;
- authorization for regulated services or third-party material, or why it
  does not apply;
- where to find a screen recording on a physical device running the latest
  OS, starting at launch and covering the typical flow plus any account
  creation, login, and deletion, user-content reporting and blocking, and
  access to paid content.

Apple sends exactly this list as a Guideline 2.1 "Information Needed" request,
which costs a first submission a full review round trip. Keep the notes under
version control when the repository keeps its listing metadata, guard their
coverage with a test, and keep recordings outside Git. Never commit demo
credentials: enter them in the console's sign-in fields (App Store Connect's
App Review Information, Play Console's App access) and have the committed notes
say where they are. Check every claim in the
notes against the submitted build. A recording or physical-device test the
agent cannot perform is an owner prerequisite with an exact next action, never
a pass.

## Deliver the readiness record

Use the repository's existing report convention or a concise PR attachment.
Include:

- Candidate revision/artifact, audit date, devices, commands, and official
  source links.
- Per-platform result: **ready within tested scope**, **not ready**, or
  **incomplete**.
- Findings with severity (blocker / major / minor / advisory), evidence,
  source or design basis, remediation, and retest outcome. Separate fixed
  findings from open ones.
- A coverage table with **verified**, **failed**, **unverified**, and
  **N/A**. A source-only inspection is not a runtime pass; a simulator is not
  physical-device coverage; an automated scan is not a VoiceOver/TalkBack
  session or complete WCAG conformance.
- Remaining release prerequisites with owner and an exact next action.
  Unverified submission-critical items prevent a ready verdict. Explain
  inaccessible-console or manual-testing limits without claiming those checks
  passed.

Keep reusable procedure in the skill and dated findings in the report.
Re-audit changes made after the tested candidate; do not carry evidence across
unrelated artifacts. When shipping is requested, hand the concrete fixes and
unresolved release prerequisites to the repository's shipping workflow.
Merging improvements is distinct from declaring the app ready for public store
submission.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill in `skills/app-store-readiness/`.
Repositories get it from `agent-tool skills install --apply`; do not edit the
installed copy. Change it in agent-tool by PR. A repository's readiness guide,
lanes, devices, and store records belong in its own docs, such as
`docs/readiness.md`.
