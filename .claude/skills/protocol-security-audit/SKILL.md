---
name: protocol-security-audit
description: Audit the client-sdk ↔ API trust boundary in both directions (an honest client detects a dishonest API; an honest API detects a dishonest or misconfigured client) with parallel slice auditors, independent probe verification, read-only TLA+ model auditing and recommendations, and a GitHub issue report. Use for a requested protocol security or sync-integrity audit, not a single-diff review.
---

# Protocol Security Audit

Audit the Tearleads protocol boundary between `packages/client-sdk` and
`packages/api`, including `packages/crypto`, `packages/api-client`, and the
backup paths in `packages/app`, against two invariants:

- **A. An honest client detects a dishonest API.** Server data that drives
  decryption, recipient wrapping, signing, local deletion or overwrite,
  checkpoint advancement, or authorization is verified against signed
  artifacts, pinned identities, and local checkpoints.
- **B. An honest API detects a dishonest or misconfigured client.** The API
  rejects submissions that are unauthorized, malformed, or that honest clients
  would later refuse.

A **parity** gap, where the API accepts what honest client verifiers refuse,
breaks both invariants at once and violates the no-brick invariant. Parity gaps
have produced the most severe past findings, so hunt for them first.

The deliverable is a verified findings report, including an audit of the
existing TLA+ models and recommendations to fix or augment them, and a GitHub
issue. An audit request authorizes read-only analysis, existing checks, and
scratch probes outside the checkout. **Do not implement TLA+ updates as part
of the audit.** This includes models, configurations, negative controls, trace
fixtures, registries, and model documentation. Put proposed changes in the
report; implementation requires a separate follow-up task. Do not create or
commit an audit implementation branch, apply production fixes, push, or open
PRs as part of the audit. The repository is public: confirm before creating
the issue unless the user already asked for one, and say that it discloses
exploitable paths.

## Arguments

- Optional focus: slice names from
  [`references/auditor-brief.md`](references/auditor-brief.md) or a subsystem.
  Defaults to every slice.
- Optional extra exclusions, such as issue numbers or finding classes.
- Optional revision. Defaults to `HEAD` of the fast-forwarded default branch.

## Rules every finding is judged against

- **No bricked device.** A client refusal is acceptable only for data an honest
  server can never produce: bad signatures, forks, rollbacks below the device's
  own checkpoint, or citations regressing below signed history. No device's
  ability to read or write may depend on another device's cache or write.
  Every suggested fix carries an explicit no-brick check. Prefer server-side
  enforcement at commit.
- **Default out of scope:** equivocation and split view; cold-start rollback on
  a device with no checkpoint; first-contact identity TOFU; key transparency,
  witnesses, and semantic currentness (#2186 or its successor); pure
  availability or withholding; DoS and rate limits; residuals that
  `docs/security-guarantees.md` already accepts.
- **Documentation is a claim.** Anything `docs/security-guarantees.md` promises
  that the code does not implement is a finding.

## 1. Establish the baseline

1. Record the audited revision with `git rev-parse HEAD` and note any dirty
   paths. Audit committed code only.
2. Start the existing formal checks from
   [`references/formal-models.md`](references/formal-models.md) in the
   background now, logging to the session scratchpad, so their results are
   ready before verification.
3. If `packages/client-sdk/dist` is older than the SDK source, rebuild it once
   with `bun run --filter='@tearleads/client-sdk' build`. `packages/api`
   resolves the SDK from `dist`, so API probes otherwise test stale code. The
   brief tells auditors not to rebuild it themselves.
4. Read `docs/security-guarantees.md` and `formal/README.md` in full.
5. Build the known-issues list so auditors do not re-report fixed work:
   - prior audit issues and their follow-ups, with each finding's fix PR
     (`gh issue list --state all --search "audit in:title"`, plus #2158 and
     #2266). Read the closing comments too;
   - the "Not in scope" or follow-up sections of each fix PR
     (`gh pr view <n>`), where carried-forward items are recorded;
   - security commits since the last audit, from
     `git log --since=<last audit> --oneline` filtered for keying, verify,
     signature, checkpoint, projection, grant, wrap, purge, and incident. Pass
     these to auditors as the least-reviewed code to examine first.

   A known item is reported again only as a regression or a bypass.
6. Size the surface with non-test TypeScript line counts per directory, so
   slices stay balanced. Split an oversized slice rather than skimming it.

## 2. Fan out slice auditors

Launch one read-only `general-purpose` subagent per slice with the Agent tool,
all in a single message so they run in parallel (nine by default, with `sync`
split into `sync-placement` and `sync-runtime`). Each prompt is the shared brief
from [`references/auditor-brief.md`](references/auditor-brief.md) with its
placeholders filled, followed by that slice's section. The filled brief may go
in a scratchpad file that each prompt requires the auditor to read in full
first. Give each auditor its own scratchpad subdirectory for notes and probes.
Use the Workflow tool only if the user has opted into workflows.

While auditors run, do not repeat their searches. Verify each report as it
arrives (step 3) instead of waiting for all of them, and give the user a
one-line status when a report lands.

## 3. Verify every finding

Auditors over-report and mislabel reachability. Nothing reaches the report on
an auditor's word alone.

- Work High and parity findings first.
- Re-read the cited code on the real production call path. Confirm option
  defaults at the call site, not only in the helper; an omitted option such as
  `authorizationMembership` silently takes the verifier's default.
- Decide honest reachability from the honest client's own flow. A server-side
  guard gap is reachable by honest use only if the SDK never avoids it. For
  example, the SDK delete path does not revoke grants first.
- Prefer a runtime probe. Write it in the scratchpad, import repository modules
  by absolute path, and run `bun test <absolute path>` from the owning package
  directory so workspace imports resolve. Reuse
  `packages/crypto/src/keying/testFixtures.ts` and
  `packages/client-sdk/test/helpers/`. Never add probe files to the checkout.
  Re-run an auditor's probe yourself and read what it asserts: a probe that
  calls a helper directly proves less than one that drives the production
  handler.
- Run API probes with `API_DATABASE=memory` (PGlite, Postgres semantics). The
  sqlite backend hides uuid lowercasing and text normalization. For parity,
  the strongest evidence is a probe from `packages/api` that commits through
  real routes and feeds the served projection to the real SDK verifier.
- Build long chains or deep trees with fixtures rather than routes when a probe
  needs thousands of commits; route-driven cost grows with history.
- Generalize each confirmed root cause. Search sibling artifact types and twin
  paths (principal state, access event, write header; document and blob
  stores; container and document verifiers). A second instance often has a
  worse impact than the first.
- Merge findings from different slices that share a root cause, and keep the
  strongest impact analysis. Expect several: api-writes overlaps every
  API-side slice, and sync overlaps identity and documents.
- Drop findings that are documented residuals, unreachable, or fixable only by
  a refusal that would brick a device. Say why in the coverage section.

Label each surviving finding:

| Label | Meaning |
| --- | --- |
| Probed | Reproduced by a runtime probe against repository code |
| Verified | Production call path independently re-read and confirmed |
| Traced | One auditor's trace only; never presented as confirmed |

Severity:

- **High:** permanent lockout of shared data reachable by honest use or by any
  single writer, or a key wrapped for an unauthorized recipient.
- **Medium:** data loss, confidentiality steering that needs a malicious
  server, or lockout with a narrow trigger.
- **Low:** metadata leaks, incident-ledger integrity, or attacks that need a
  malicious server plus a colluding member.

A key wrapped for an unauthorized recipient is High even when it needs only a
malicious server, as in #2158. It drops to Low when a colluding member must
also act. Medium steering means choosing where a write lands without a key
reaching an unauthorized party.

## 4. Audit the TLA+ models and recommend changes

Audit the existing formal models without modifying them. Follow
[`references/formal-models.md`](references/formal-models.md):

1. Review the relevant models, configurations, negative controls, and
   production mappings for incorrect assumptions, missing behaviors, and gaps
   in the properties they check, even if no production finding requires a
   model change.
2. Classify every verified finding as model-shaped or not, with a reason.
3. For each model-shaped finding, report the existing coverage and recommend
   the module, rule or parameter, property, configurations, negative controls,
   and trace coverage that should be fixed or added in a follow-up task.
4. Run relevant existing formal checks without changing their inputs. Capture
   results and available counterexamples; if a finding needs new model work
   to reproduce, record that limitation and the proposed validation instead.

A finding that is not model-shaped still names the regression test (unit,
property, or parity test) that would have caught it. Recommendations are not
implemented or model-checked fixes; label their validation status explicitly.

## 5. Report

1. Print a terminal summary grouped by invariant (parity, A, B) and ranked by
   severity. Give each finding its label, a one-line mechanism, `file:line`,
   and TLA+ status. End with what looked sound and the recommended fix order.
2. Draft the issue from
   [`references/issue-template.md`](references/issue-template.md) in the
   scratchpad. After confirmation, or if the user asked for an issue, create
   it with `gh issue create --label bug --body-file <path>`.
3. Include actionable TLA+ follow-up recommendations and their validation
   gaps. State that no production or formal-model fixes were implemented as
   part of the audit.
4. Save a project memory with the audited revision, the issue number, the
   verification labels, and the fix status, so the next audit's known-issues
   list starts there.
