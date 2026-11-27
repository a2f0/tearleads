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

## Key rotation, shrink, and revocation scaling (`perf:rotations`)

```sh
createdb tearleads_rotations_probe
bun run --filter='@tearleads/client-sdk' build
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_rotations_probe" \
  bun run perf:rotations --rotations 1,4,8 --depth 3 --samples 1
```

Measures how multi-party access-control mutations and post-revocation recovery
scale with accumulated rotation epochs (`--rotations`) and nested folder chain
depth (`--depth`), against a local PostgreSQL scratch database through both a
wire-counting PostgreSQL proxy and a wire-counting HTTP proxy.

At each tier, the probe sets up a fresh organization with a nested folder chain
(`level-1 -> ... -> level-D`), a shared group on `level-1`, a deeper direct
grantee on `level-D`, and a two-hop roster chain (`Alice -> Bob -> Frank`),
then measures eight phases:

| Phase | What it exercises |
| --- | --- |
| `group-share` | `shareWithGroup` on the chain root plus descendant re-citation |
| `group-shrink` | `removeUserFromGroup` policy commit and container rekey carry after `R` accumulated rotations |
| `stale-writer-repair` | Idle pre-rotation writer edits a document, triggering `409` refetch, keyring walk, content-key repair, and commit |
| `direct-revoke` | `revokeGrant` on `level-1` carrying intermediate levels above the deeper direct grant |
| `grantee-subtree-repair` | Deeper direct grantee holding a pre-revoke path edits and repairs its own subtree inline (when `--depth >= 2`) |
| `subtree-move` | `moveContainer` rotating the moved folder key (and removing inherited group access when `--depth >= 2`) |
| `fresh-reader-hydration` | Freshly logged-in install (empty SQLite DB) discovers and decrypts the document across the accumulated folder keyring |
| `roster-vouched-share` | Fresh self-anchor admin shares a folder with a transitively enrolled member (`Alice -> Bob -> Frank`) without importing their link |

Each phase records wall time, HTTP requests, `409` conflicts, request/response
wire bytes, PostgreSQL statements/round trips/rows/bytes, actor local SQLite
calls/mutation-lock holds/`EXPLAIN QUERY PLAN` flags, and process CPU/memory
peaks. Reports are saved under `.test_files/performance/rotations-<run>.json`
and `.md`.

## Rotation baseline scaling (`perf:baselines`)

```sh
createdb tearleads_baselines_probe
bun run --filter='@tearleads/client-sdk' build
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_baselines_probe" \
  bun run perf:baselines --sizes-mb 1,5,13 --chunk-mb 6 --samples 1
DATABASE_URL="postgres://$USER@localhost:5432/tearleads_baselines_probe" \
  bun run perf:baselines --sizes-mb 13 --race --samples 1
```

Measures how multi-linked document unlink rotation baselines scale with
incompressible history size (`--sizes-mb`, default `1,5,13` MiB) across inline
single-segment baselines (`1 MiB`), multi-segment inline baselines (`5 MiB`),
and staged `/baseline-stages` uploads (`13 MiB`, past the 16 MiB base64/envelope
single-request ceiling), against local PostgreSQL through both wire-counting
proxies.

Pass `--race` to pause Bob's first `POST /documents/:id/unlink` at the HTTP
proxy after baseline preparation/staging, have Alice commit a racing edit, and
release the unlink so Bob receives `409 document_unlink_rotation_baseline_stale`,
resumes the stage via `GET /baseline-stages/:id`, uploads a tail segment, and
commits. (The racing peer's single sync request is included inside the
`first-unlink-rotate` window.)

| Phase | What it exercises |
| --- | --- |
| `seed-history` | Chunked creation and editing of incompressible random hex text up to `sizeMiB` |
| `first-unlink-rotate` | Unlinking the second folder (`inline` or `/baseline-stages`), plus `409` tail retry when `--race` is enabled |
| `fresh-reader-sync` | Freshly logged-in empty-DB install discovers, syncs across baseline pages, and decrypts the full document |
| `second-unlink-rotate` | Re-linking into the second folder, appending one edit, and unlinking again across an existing baseline group |

Each phase records wall time, baseline mode (`inline` vs. `staged`), staged
segment upload and stage-resume counts, HTTP requests/`409`s/wire bytes,
PostgreSQL statements/round trips/rows/bytes, actor local SQLite attribution and
`EXPLAIN QUERY PLAN` flags, and process CPU/peak RSS delta. Reports are saved
under `.test_files/performance/baselines-<run>.json` and `.md`.
