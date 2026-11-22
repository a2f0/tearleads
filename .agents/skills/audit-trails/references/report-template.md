# Audit trail coverage report

Record repository, full commit SHA, date, dirty-path treatment, scope,
exclusions, and whether this is a complete or partial review of that scope.

## Coverage

| Workflow | Mutation and event mechanisms checked | Reader checked | Status |
| --- | --- | --- | --- |

Use covered, gap, partial, or unchecked. Covered means the stated behavior
was traced or tested; it does not certify every concurrency or failure path.

## Ranked findings

| ID | Finding | Impact | Evidence | Existing issue |
| --- | --- | --- | --- | --- |

For each finding:

- **Trigger and result:** a concrete action and the missing or misleading
  history it leaves. Explain what attribution or reconstruction is lost.
- **Evidence:** source links pinned to the audited commit and relevant line
  numbers; trace the mutation, triggers/helpers, and readers. Include probe
  commands, outcomes, and artifact paths for Reproduced findings.
- **Existing coverage:** separate histories, current-state actor fields,
  retention policy, and why they do or do not satisfy this case.
- **Recommendation:** action/resource/actor/details and transactional behavior;
  required reader permissions and visibility; no speculative historical data.
- **Acceptance criteria:** observable success, no-op/failure, attribution,
  isolation, and retry/retention behavior appropriate to the finding.

## Unverified leads and remaining scope

Separate incomplete traces and unavailable tests from ranked findings. Record
the next verification step and any unchecked entrypoints. A clean source trace
does not prove deployed migrations, production data, or runtime behavior.

## Audit usage receipt

Follow [usage tracking and publication](usage-receipts.md). Replace placeholders;
use `unavailable (reason)` rather than a fabricated zero. Publish this section
inside the report body, bounded by the same run's markers on every update:

<!-- audit-usage:RUN_ID:begin -->

- **Run / batches / scope:** opaque run ID; batch IDs; full, partial, or resumed.
- **Revision:** audited repository and full commit; dirty-path treatment.
- **Skill / harness:** audit-trails version (the `agentToolVersion` that
  `.agent-tool-skills.json` records) or content hashes (including loaded
  references); harness version; provider/model and effort if exposed.
- **Evidence / baseline:** sanitized source kind and counter semantics;
  dedicated run or before/after boundary; evidence digest, not a private path.
- **Cutoff / outcome:** last completed request before publication, or child exit
  observed by outer launcher; timestamp; completed, partial, or interrupted.

| Batch / actor / provider / model | Input | Output | Cache read | Cache write | Reasoning | API calls | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fill one row per measured scope; distinguish external CLI auditors | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

- **Coverage / rollup:** coordinator, children, auxiliary calls, and external
  CLIs included/excluded; only nonoverlapping measured subtotals; no grand total
  for partial coverage. State whether cache/reasoning are already included.
- **Limitations:** unavailable fields and reasons, shared-session contamination,
  model attribution limits, unobservable tail/publication/final reply. Label
  optional cost as an estimate, not subscription charges or quota consumption.

<!-- audit-usage:RUN_ID:end -->

Keep private checkpoint paths and raw evidence out of the published report.
Locally record the canonical issue URL and the receipt's run marker; for this
body-based publication, receipt location is the issue body (comment ID: not
applicable). Keep that handle even if a later update or verification fails.

## Suggested implementation order

Order by impact and dependencies. State which changes, if any, were made in
the current task separately from the audit's findings.
