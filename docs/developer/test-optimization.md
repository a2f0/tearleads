# Test optimization measurements

Use the `optimize-tests` skill in `.agents/skills` (Codex) or `.claude/skills`
(Claude) for another pass. It ranks measured test costs, preserves unique
regressions, and requires a coverage map before deleting a test.

## First pass: October 15, 2026

Baseline checkout: `51f16372de6c4d3a989b0bd8a8780a0a2c84ec0a`.
The [CI baseline run](https://github.com/a2f0/tearleads/actions/runs/38776184981)
at `fe252fb1184bbc2e8103631b79978ce30ca87d6f` had test cache misses. Its API,
SDK, and app jobs took approximately 18, 16.7, and 17 minutes respectively.
API and SDK were the requested focus; app remains another critical-path lead.

The most expensive reported file totals included:

| Package/backend | Test file | Case sum |
| --- | --- | ---: |
| API / SQLite | `storedDocumentHistory.test.ts` | 89.52 s |
| API / PGlite | `storedDocumentHistory.test.ts` | 81.72 s |
| API / PGlite | `automaticAncestorRepair.test.ts` | 44.99 s |
| API / PGlite | `mutations.test.ts` in container routes | 42.58 s |
| SDK | `syncContainerRekeyPrefix.test.ts` | 23.65 s |
| SDK | `syncRepairLimits.test.ts` | 10.30 s |
| SDK | `projectionAuthorityPageBudget.test.ts` | 8.91 s |

These are sums of timed cases, not file or job elapsed times. Hooks and untimed
cases are absent: 12 passing PGlite cases, 14 SQLite cases, and 12 SDK cases had
no parsed case duration. API backends execute concurrently, so adding their
totals does not predict CI time saved.

## Retained optimization

`packages/client-sdk/src/workflows/documents/syncContainerRekeyPrefix.test.ts`
rebuilt the same 17-level signed ancestor graph and document six times. It now
builds that immutable template once in `beforeAll`. Each case clones all graph
and key data, reconstructs its identity resolver, re-registers manifest
citations after the preload's registry reset, and creates a fresh database.
No checkpoint or mutation response is shared between cases.

Local process wall time, including setup, using Bun 1.4.2 on Darwin arm64:

| Scope | Before | After | Change |
| --- | ---: | ---: | ---: |
| SDK prefix file, six passing cases | 15.32 s | 10.69 s | 30.2% less |

Command, run through `bun run agent:run` from the repository root:

```sh
bun test --cwd packages/client-sdk \
  ./src/workflows/documents/syncContainerRekeyPrefix.test.ts --max-concurrency=4
```

All six test bodies retain their original assertions. Repeated fixture
assertions move into setup, which explains the reported assertion-count change
from 20 to 14. No test, backend, or cryptographic verification was removed.
The measured scope is one file, not the full SDK suite or the CI critical path.

Negative controls in a scratch checkout confirmed that the retained tests fail:

- Disabling checkpoint persistence causes the cold-device case to reject with
  `locally acknowledged access manifest does not begin at epoch 1` instead of
  reaching its expected post-commit `unrefreshable` stop.
- Suppressing terminal-refusal classification makes the 403 case observe zero
  terminal failures where it asserts one.

A scratch isolation probe mutated one clone's key bytes and paths, cleared the
manifest registry, and confirmed that a second clone retained the original data
and restored its citations. It and the six regressions passed together in
randomized order with seed 2544. The deliberate production mutations remained
in the scratch checkout and were restored before this run.

## Rejected experiment and next leads

The API history fixture was experimentally changed to bulk-insert signed
events/manifests without maintaining unused projections. Its local wall times
were 110.79 to 105.59 seconds on PGlite, but 100.20 to 106.44 seconds on SQLite.
That inconsistent result did not justify another fixture implementation, so
the experiment was reverted. The SQLite diagnostic split was 85.37 seconds of
signed-history setup and 20.47 seconds of verification. The first PGlite run
also shared the host with other test processes; treat these as investigative
timings rather than a stable performance comparison.

Keep the API's 4,098-entry history: it protects the removal of the former
4,096-entry limit in PR #2383. Reducing its size would erase that regression.
Next candidates are API automatic ancestor repair and container mutations, then
SDK repair limits and authority-page budgeting. Re-measure at the next revision
before acting; these historical totals identify where to look.

Raw baseline, experiment, and negative-control logs were saved locally under
`git rev-parse --git-path test-optimization`; they are not tracked artifacts.
