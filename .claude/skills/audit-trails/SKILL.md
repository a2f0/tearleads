---
name: audit-trails
description: Audit application workflows for missing or incomplete audit trails and produce an evidence-backed report or GitHub issue. Use for a requested audit-coverage review, not a general security review or a checklist inspection within the product.
---

# Audit Trails

Trace consequential application changes from their entrypoints to durable
history and authorized readers. Identify missing events, incomplete attribution,
misleading events, and inaccessible history. A timestamp, application log, or
current-state row alone is not a history of who changed what.

Work from repository code and local tests. Do not read production data or
credentials, implement findings, deploy, or ship changes as part of this skill.
Create or update a GitHub issue when the user requested one; otherwise return
the report without publishing. Honor authorization already given in the session.

## Establish scope

Start [usage tracking](references/usage-receipts.md) now, before audit work or
delegation. Save a baseline and run/batch identity beside the private report;
checkpoint usage with coverage after each slice and before a pause. A resume
keeps the run identity, previous receipts, and publication handle, but starts a
new nonoverlapping batch. Missing counters must be disclosed, not estimated.

Read repository guidance and its product and retention documentation. Resolve
the repository with `gh repo view --json nameWithOwner`. Record the audited
commit, dirty paths, requested focus, and exclusions. Do not claim a committed
revision describes uncommitted behavior. Use a clean worktree if dirty files
would affect a probe of the committed revision.

Read the repository's own audit notes (its `AGENTS.md` or the docs it points
to) when present: they may map entrypoints, the shared event store and its
helpers, migrations, readers, capability checks, and a local probe harness.
Treat such a map as a starting point, not a coverage claim. Otherwise discover
the entrypoints, event stores, migrations, and readers yourself.

With no focus, inventory the application and prioritize access changes,
destructive actions, financial changes, and externally initiated work. Review
manageable slices sequentially; keep a coverage table so partial work is not
reported as a complete audit. With `resume <report-path>`, verify the recorded
repository and revision, reuse its evidence, and continue unchecked paths. If
the revision changed, revalidate affected findings before carrying them forward.

Keep reports and scratch probes outside the checkout unless the user requested
a repository artifact. Record the report's absolute path for resuming.

## Trace coverage

Inventory write entrypoints: UI/API mutations, authentication hooks, webhooks,
scheduled jobs, inbound messages, maintenance scripts, and shared helpers used
by REST or MCP. Read-only sensitive access is a separate requirement; flag it
only when repository policy or the requested scope requires an access log.

For each selected workflow, follow:

1. Actor and organization resolution, authorization, and validation.
2. The actual persisted mutation and its success, no-op, and failure paths.
3. Event writes through direct calls, shared helpers, database triggers, or
   provider-specific histories. Read migrations in order, including dropped
   and replacement triggers; when trigger coverage is uncertain, inspect the
   final schema in a scratch database with every migration applied, not one
   built before a later migration. Search results are leads, not proof of
   absence.
4. Atomicity between the change and its event; conditional writes, stale saves,
   retries, and duplicate webhooks must not produce misleading success events.
5. Stable action, resource/subject IDs, time, actor snapshot, and minimal useful
   change details. Distinguish the initiating human, API key/channel, and system
   or provider actor. Never recommend fabricating a human for background work.
6. Authorized retrieval in the workspace feed and relevant record history,
   tenant/capability boundaries, and what remains after deletion or retention.

Treat a separate contract or provider history as existing coverage. Report a
shared-feed integration gap separately from a missing durable trail. Likewise,
documented purge behavior is not automatically a defect, and historical gaps
cannot be repaired by inventing actors, timestamps, or old values.

Proposed details should use an allowlist. Do not copy secrets, tokens, document
contents, screening reports, or unrestricted payloads into events or issues.
If a new event would expose restricted data through a broadly readable feed,
include the required reader permission change in the proposal.

## Verify and rank

Before promoting a finding, trace the write and all plausible event mechanisms.
Use an existing test or a small synthetic local probe when it can resolve a
material uncertainty. A useful probe changes a record, inspects durable history,
and checks rollback, replay, or reader isolation where relevant. Record the
command and result. Do not create tests that merely search for helper names.

Label evidence **Reproduced** (a local behavior probe or test) or **Traced**
(a complete source path). Keep unresolved suspicions under **Unverified leads**.
Do not present absence from a grep result as a verified finding.

Rank impact with a concrete explanation: high for changes to access, money,
or destructive operations that cannot be attributed; medium for ordinary
business changes or missing shared visibility with another durable trail;
low for presentation or convenience gaps. Adjust to actual product behavior.

Search existing issues before publication. Link matching work and avoid opening
duplicates. Recheck code before reusing a historical finding.

## Deliver

Use [the report template](references/report-template.md). Each finding needs a
trigger, actual and expected behavior, revision-pinned evidence, impact,
recommended event/reader behavior, and observable acceptance criteria. Include
checked coverage, unverified leads, and explicit limitations.

Include an **Audit usage receipt** in every report, even for partial work,
zero findings, or unavailable counters. Follow [usage publication and
readback](references/usage-receipts.md#publish-and-resume): the receipt goes in
the issue body so findings and accounting publish together. Preserve existing
publication and security-disclosure authorization; without it, save locally.
Prefer one ranked report issue unless the user requested separate issues. If a
matching issue already covers the audit, update it only when authorized to do
so; otherwise link it in the report. Never recreate an issue to retry a failed
receipt update. Report incomplete publication alongside the saved report.

Return the issue or report link, the highest-impact gaps, what was actually
checked, and remaining scope. Discovery does not imply the gaps were fixed.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill in `skills/audit-trails/`.
Repositories get it from `agent-tool skills install --apply`; do not edit the
installed copy. Change it in agent-tool by PR. Repository-specific audit maps,
probe harnesses, and retention rules go in that repository's `AGENTS.md` or the
docs it points to.
