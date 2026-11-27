# Multi-party scenario profiler and protocol probes

Companion reference to [`packages/performance/README.md`](README.md) for
profiling multi-party keying, revocation, and baseline workflows inspired by
[`packages/bob-and-alice`](../bob-and-alice/README.md).

## Multi-party bob-and-alice scenarios (`perf:scenarios`)

```sh
bun run --filter='@tearleads/client-sdk' build
bun run perf:scenarios --scenario firstMemberAdd --scenario rotationHistory
bun run perf:scenarios --scenario groupShrinkCarry \
  --statements --param-hash --client-statements --payload-audit
bun run perf:scenarios --baseline .test_files/performance/scenarios-<run>.json
bun run perf:scenarios --compare <before.json> <after.json>
```

`perf:scenarios` discovers every `*.test.ts` file under
`packages/bob-and-alice/src/scenarios` and runs each scenario alone from
`packages/bob-and-alice` (`API_DATABASE=memory` unless already set). Whereas
`perf:canaries` covers the app's single- and dual-pane happy-path request
budgets, `perf:scenarios` covers the full multi-party keying protocol: group
shrinks and carry batches, direct and group revocations, multi-rotation
keyrings, stale-path rehydration, concurrent 409 conflict retries, transitive
roster-vouched shares, offline revocation, false-span voiding, and multi-segment
or staged rotation baselines.

An opt-in observer preload (`src/scenarios/scenarioHttpPreload.ts`) hooks the
bob-and-alice in-process API server (`src/harness/apiServer.ts`) and trace sink
(`src/harness/trace.ts`) with zero overhead during normal test runs:

| Field | What it measures |
| --- | --- |
| `runs[].http` | Total HTTP requests, `409` conflicts and `4xx` counts, error codes, request/response wire bytes, server wall time, `x-known-manifests` citations, normalized per-route counts, and `World` harness operation counts |
| `runs[].statements` | With `--statements` (and optional `--param-hash`): API ORM statement counts, per-route statements, transaction/lock-hold counts, and pure read repeats |
| `runs[].clientSql` | With `--client-statements`: client SQLite statements, serialized mutation-lock holds/waits, and top normalized queries across all devices in the scenario |
| `runs[].payloadAudit` | With `--payload-audit` (and optional `--stacks`): per-device HMAC attribution, top request/response field bytes, echo/redelivery/re-downloaded upload bytes, and exact-head re-reads |

Reports are saved under `.test_files/performance/scenarios-<run>.json` and
`.md`, with per-scenario logs and raw captures under `scenarios-<run>/`.
Relative paths for `--baseline` and `--compare` resolve from the repository
root.
