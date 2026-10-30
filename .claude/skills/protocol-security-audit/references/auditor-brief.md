# Auditor Brief

Send the selected auditor the shared brief with its placeholders filled, then
the bug-class list and exactly one section from [slices.md](slices.md).
Apply the limits in [`batching.md`](batching.md); a large slice may be several
queued work items.

## Shared brief

```text
You are the selected slice auditor on the Tearleads monorepo
(<REPO_ROOT>, revision <SHA>). READ-ONLY: do not edit, create, or delete files
in the repository, do not commit, and do not run state-changing git commands.
Save probes, logs, and evidence only under <SCRATCH_DIR>. You may run existing
tests. Do not spawn agents, invoke another audit skill, publish issues or
comments, or change external state. Reporting and any authorized publication
belong to the coordinator.

Your exact work item and remaining coverage: <WORK_ITEM>
Budget: at most 25 tool calls; reserve the last five for triage and reporting.
Use targeted searches and reads, not whole-directory dumps. Save candidate
evidence as you go. At the limit, stop and report unchecked paths, unresolved
candidates, and the next concrete step. A partial slice is a valid batch
result; never call it complete or clean. Do not expand scope to fill a quota.

Audit the assigned existing TLA+ models, including their assumptions,
properties, configurations, and production mappings. Use prior model reviews
referenced in the work item; queue uncovered models. Do not
implement model changes, negative controls, trace fixtures, or documentation
updates; recommend fixes or additions in your report for a separate task.

Mission: find data-synchronization and security bugs at the client-sdk <-> API
integration against two invariants.
- A. An honest client detects a dishonest API. Server data that drives
  decryption, recipient wrapping, signing, local deletion or overwrite,
  checkpoint advancement, or authorization must be verified against signed
  artifacts, pinned identities, and local checkpoints, never trusted as
  projection rows.
- B. An honest API detects a dishonest or misconfigured client. The API must
  reject unauthorized or malformed submissions. Verifier parity matters most:
  if the API accepts an artifact that honest client verifiers reject, one
  client can poison shared state and brick every device. If the API rejects
  what honest clients produce, that is a lower-priority availability bug.

Out of scope, do not report: <EXCLUSIONS>

No-brick rule: a client must never refuse data an honest server can produce,
and no device's ability to read or write may depend on another device's cache
or write. If a fix needs such a refusal, say so and propose a server-side or
non-bricking alternative.

Already fixed or tracked; report only a regression or a bypass:
<KNOWN_ISSUES>

Security changes since the last audit are the least-reviewed code at this
revision; scrutinize them first (read their diffs with `git show <sha>`):
<RECENT_SECURITY_PRS>

Read the coordinator's compact baseline at <BASELINE_FILE>, then the exact
sections of docs/security-guarantees.md, formal/README.md, the model index
formal/models.md, and model docs relevant to your work item. The baseline
provides source references, not proof that the code meets a guarantee. Do not
reload the whole issue history or all slice/model documents. Claims the code
does not implement are findings.

Quality bar: report only issues traced through real code paths with file:line
evidence, ideally with a probe. Try to refute each candidate: is there a check
elsewhere, is the path reachable in production, does a signature cover the field?
Confirm option defaults at the production call site, not only in the helper.
Decide honest reachability from the honest client's own flow (for example,
whether the SDK revokes grants before a delete). List plausible but untraced
items separately.

Probes: import repository modules by absolute path and run
`<REPO_ROOT>/node_modules/.bin/agent-tool run -- bun test <absolute path>`
from the owning package directory. Copy retained raw logs to the durable audit
directory with probe results; use
`bun run --cwd <REPO_ROOT> agent:logs <path>` for bounded excerpts.
API probes use
`API_DATABASE=memory` (PGlite, Postgres semantics); the sqlite backend hides
uuid lowercasing and text-column normalization. The strongest parity evidence
is a differential probe run from packages/api that commits through real routes
and feeds the served projection to the real SDK verifier. Probe at most two
distinct root causes, with at most one harness-repair attempt per probe; keep
additional candidates as traces for later verification. The coordinator has
checked packages/client-sdk/dist at this revision: do not rebuild it or run
bun install. Existing TLC results are in <FORMAL_LOG_DIR>; read relevant
summaries, do not re-run the suite or paste passing logs into the report.

Return the report itself as your final message, under 1,200 words, linking
longer evidence files rather than omitting evidence; the coordinator saves it
as report.md in your scratch directory. Do not write the report file
yourself. If any file write is refused, carry that content in the final
message instead of working around the refusal. For each finding give:
a title; direction (A, B, or Parity); severity (High, Medium, Low) and confidence
(Probed, Confirmed-by-trace, Plausible); file:line evidence; attacker precondition;
a concrete step-by-step scenario; the impact; a suggested fix with a no-brick
check; and whether it is model-shaped (a refusal rule, commit guard, lock,
ordering, or recovery rule that a TLA+ model could express). For model-shaped
findings, identify existing coverage, recommended model fixes or additions,
and validation still needed. Report defects or coverage gaps in the existing
models even when no production bug is confirmed; distinguish model evidence
from production evidence. Include the API/client verifier pairs and route
bindings checked so later slices need not repeat them. End with short lists
of checked paths, refuted candidates, unchecked paths/models, and next steps.
Open the message with candidate ids/severities, coverage status, and the
next step.
```

Default `<EXCLUSIONS>`: equivocation and split view; cold-start rollback on a
device with no checkpoint; first-sight (`observed`) pins of signers and other
referenced users no identity link verified; key transparency,
witnesses, and semantic currentness (#2186 or its successor); pure availability
or withholding; DoS and rate limits; residuals documented as accepted in
`docs/security-guarantees.md`; plus any exclusions the user added.

Fill `<KNOWN_ISSUES>` with slice-relevant entries from the saved index, using
the audit issues, their closing comments, and the "Not in scope" or follow-up
sections of each fix PR; carried-forward items live there, not in issue bodies.
Name withdrawn designs explicitly (such as
the #2173/#2174 client currency rule) so auditors do not re-propose them. Fill
`<RECENT_SECURITY_PRS>` with security PRs relevant to this work item since the
last audit and one line on what each changed. Fill `<WORK_ITEM>` with exact
paths, relevant models, and saved coverage/next steps on resume. Point
`<BASELINE_FILE>` at the compact baseline and `<FORMAL_LOG_DIR>` at the shared
formal logs, not the auditor's private directory.

The coordinator may write the filled brief to `<SCRATCH_DIR>/brief.md` and
require the auditor to read it first. It contains only this work item's
context, not the full audit archive or the entire slice catalog.

## Bug classes to sweep

Append this list to every brief. Each class produced real findings in an
earlier audit.

- **Signed bytes that do not survive storage.** A signed or hashed field stored
  in a typed column (timestamp, numeric, normalized text) and served back
  re-serialized. Compare submitted bytes with served bytes, not just parse
  validity. Try an uppercase UUID in a `uuid` column and a lone surrogate
  (`"\ud800"`) in a `text` column, on every signed id and free-text field.
- **Derived-field parity.** A label, id, or target key the client derives from
  pinned identity or signed state (recipient key epoch ids, target keys) that
  the API accepts free-form, or rebuilds from what was stored so its own check
  always agrees.
- **Skip instead of refuse.** Shared verifier loops that `continue` past
  out-of-scope elements (foreign-organization or unlinked citations, extra
  targets). The API stores the extras and serves them; readers must resolve
  every one and cannot.
- **Commit bounds versus read bounds.** Depth, history length, and carried or
  inline caps enforced when a path or chain is read or verified but not when
  it is committed, so the API commits what it later refuses to serve. Compare
  every read-time constant with the commit-time guard and its twin constant.
- **Dependency read authorization.** Everything a verifier must fetch
  (principal policies, cited manifests) must be readable by every device that
  must verify it, including heads cited only by history, siblings of a
  multi-container link, and principals since deleted.
- **Other objects' guards after a delete.** Beyond heads and links, check
  whether a delete leaves rows that other objects' commit guards (group
  successors, roster removal, group deletion) still count as current.
- **Diverging verifier options.** One shared verifier called with different
  defaults on each side, such as membership at `current` versus `referenced`,
  checkpoint enforcement, or legacy allowances.
- **Leaf-only commitments.** An artifact commits a leaf target but is later
  re-authorized through a path rebuilt from pins or current state instead of
  the path it was accepted under.
- **Rows deleted, heads retained.** A delete removes a row but keeps the head
  or link that write paths still treat as current.
- **Unsigned selectors.** Listing fields (slots, parent ids, names, flags) that
  choose where a signed write goes, even when the write itself verifies.
- **Head regression.** A mutation that can cite an older principal or ancestor
  head than its predecessor without an admin-only or currency check at commit.
- **Runtime-dependent canonical encodings.** `localeCompare`, `Intl`, default
  time zones, or platform JSON feeding a hash or signature.
- **Twin paths.** A stale flag, lock, or check present for documents but
  missing for blobs, or the reverse.
- **Security anchors lost.** Checkpoint, purge-proof, pin, or incident tables
  dropped by backup restore, identity switch, or remote reset.
- **Error mislabeling.** Availability failures recorded as tampering, or typed
  verification failures swallowed into retries or null fallbacks.
- **Unauthorized interest.** Realtime subscriptions or feeds accepted for
  objects the actor cannot read.
- **Adoption without scope.** Lost-response or discovery adoption that binds a
  local pending write to a server-chosen object without checking the signer,
  container, and organization.
- **Unsigned triggers.** Unsigned status fields (billing `purged`, listing
  flags, coded errors) that start destructive or re-homing workflows: remote
  reset, organization replacement, checkpoint deletion, re-parenting.
- **Inherited removals.** A server-asserted removal that cascades to local
  descendants or siblings, or a fence keyed by an unsigned timestamp that
  later honest listings cannot pass.
- **Multi-link liveness.** A heal or repair that needs keys or authority over
  every linked container, so a writer on one link waits on a member who spans
  them all.
- **Shared local resources.** Local storage keys or caches keyed by an id
  several slots, documents, or identities share, deleted or overwritten
  without a reference check.
