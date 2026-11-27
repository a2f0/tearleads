---
name: full-optimization
description: Run an end-to-end greenfield Tearleads optimization and bug-scrub pass across API Postgres, client SQLite, sync protocol, realtime hub, and multi-party bob-and-alice scenarios, tracking every PR in the structured Epoch 2 performance ledger to expose improvements, regressions, and cross-dimension tradeoffs.
---

# Full Optimization Pass

Coordinate a complete, multi-PR greenfield optimization and bug-scrubbing cycle
across Tearleads (`packages/api`, `packages/api-shared`, `packages/api-client`,
`packages/validators`, `packages/client-sdk`, `packages/sqlite-worker`,
`packages/app`, `packages/bob-and-alice`, `packages/performance`, and
`formal/`).

Unlike the read-only `database-efficiency-audit` and
`protocol-efficiency-audit` skills (which discover and rank proposals into an
issue without editing code), `full-optimization` executes the full
measure-implement-verify-ship-record loop across as many focused PRs as needed.
Keep matching copies of this skill under `.agents/skills/full-optimization` and
`.claude/skills/full-optimization`.

## Core Rules

1. **Preserve capabilities and security guarantees.** Every guarantee in
   `docs/security-guarantees/`, `docs/protocol-specification/`, and
   `docs/limits.md` stays intact. Any security or convergence test added for a
   fix MUST be proven to fail with the fix reverted before trusting it.
2. **Greenfield first, append-only migration hygiene.** No backward-compatibility
   shims for obsolete client data when a database reset is authorized. Keep
   `packages/api-shared/drizzle/` append-only per `bun run lint:api-migrations`,
   and remove temporary `scripts/checks/openApiCompatibilityErrors.ignore`
   entries immediately once the default branch contains the new contract.
3. **Measure every step in Epoch 2.** Record a clean baseline before edits and a
   checkpoint after every optimization PR via `bun run perf:epoch record` so
   longitudinal improvements, regressions, and cross-dimension tradeoffs (for
   example, trading client SQLite work for fewer API statements or wire bytes
   for hub CPU) stay visible in `packages/performance/results/epoch-2/`.
4. **Ratchet ceilings when headroom opens.** Never leave permanent slack in
   request-volume canary budgets, statement-budget tests, or `docs/request-budgets.md`.
5. **Rebuild `@tearleads/client-sdk` before trusting API or app tests.** API
   tests resolve `@tearleads/client-sdk` from `dist` without a stale-dist guard.
6. **Ship small, reviewable PRs through `ship-pr`.** Each PR owns one coherent
   bug or optimization slice, passes independent review (`agent-tool review`),
   CI, squash-merge, post-merge checkout `reset`, and base-health verification.
   File deferred bugs via `open-issue` rather than leaving undocumented notes.

## Phase 1: Establish the Epoch Baseline

On clean `main` (check `bun run agent-tool repo base-health` first):

1. Build runtime artifacts: `bun run agent:run --label build -- bun run build:runtime`.
2. Ensure local scratch PostgreSQL databases exist (`tearleads_plans_probe`,
   `tearleads_reload_probe`, `tearleads_realtime_probe`,
   `tearleads_rotations_probe`, `tearleads_baselines_probe`).
3. Capture the baseline suite sequentially (avoid concurrent heavy runs that
   skew timings and lock-hold peaks):
   - Canaries (`perf:canaries` with `--statements --param-hash
     --client-statements --payload-audit`)
   - Inventory (`perf:inventory --canaries <canaries.json>`)
   - Postgres generic plans (concatenate canary `*.statements.jsonl` captures
     and run `perf:plans --capture <combined.jsonl> --limit 25` against
     `tearleads_plans_probe`)
   - Multi-party scenarios (`perf:scenarios` on the core `bob-and-alice` set
     with `--statements --param-hash --client-statements --payload-audit`)
   - Scaled probes relevant to the target issues: `perf:reload`, `perf:realtime`,
     `perf:realtime-contention`, `perf:rotations`, `perf:baselines` (and local
     `workerd` when hub memory/CPU limits are in scope).
4. Record the baseline snapshot into the Epoch 2 ledger:

   ```sh
   bun run perf:epoch record \
     --id 000-baseline \
     --kind baseline \
     --label "Clean main baseline" \
     --canaries <canaries.json> \
     --inventory <inventory.json> \
     --plans <plans.json> \
     --scenarios <scenarios.json> \
     --reload <reload.json> \
     --realtime <realtime.json> \
     --rotations <rotations.json> \
     --baselines <baselines.json>
   ```

## Phase 2: Triage & Order the Work Queue

Order target issues and audit leads so correctness bugs, shared seams, and
foundational instrumentation land before dependent optimizations:

1. **Correctness & liveness bugs first** (especially bugs in `test.failing`
   `bob-and-alice` canaries or startup/realtime races that skew measurements).
2. **Database & schema hygiene** (triggers, migration guards, parent/document
   lane batching, query-plan sorts/materializations).
3. **Scaling architecture** (subtree-root realtime interest, bounded hub
   authorization, multi-segment streaming).
4. **High-impact compactness passes**:
   - API transaction-scoped pure-read elimination (verified-history and
     locked-container-row reuse under `READ COMMITTED`, validated with
     `bun run test:postgres-concurrency`).
   - Wire compactness and policy re-read reduction (`x-known-manifests`, KEK
     level/content-key/directory citations, local history reuse, org-policy
     epoch memoization).
   - Client SQLite chatter and mutation-lock reduction (immutable trust-pin
     memos, batched checkpoint reads, worker batching, trimmed tx wrappers).
5. **Cleanup & ceiling ratcheting last** (retire confirmed unread OpenAPI 2xx
   fields, tighten canary ceilings, refresh `docs/request-budgets.md`).

## Phase 3: Execute Each Slice (Iterate & Ship)

For each planned PR:

1. Create a conforming branch from live `main`:
   `bun run agent-tool branch create <type/slug> --base main --remote origin`.
2. Implement the fix/optimization cleanly:
   - Keep source files under 500 lines / 20 KB (`lint:source-shape`), explicit
     state machines tagged with `status`, and new API/SDK/app files registered
     in `scripts/architecture/subsystems.ts`.
   - Update TLA+ specifications (`formal/`), abstraction maps
     (`bun run lint:formal-maps`), and negative controls whenever protocol,
     realtime, or convergence assumptions change; verify with
     `bun run check:protocol-models` and `bun run check:protocol-negative-controls`.
   - Enhance `packages/bob-and-alice` scenarios and `packages/performance`
     probes when existing fixtures do not exercise the targeted failure or scale
     axis.
3. Validate before review:
   - Rebuild SDK (`bun run --filter='@tearleads/client-sdk' build`), then run
     targeted `bun run check:package <workspace>` suites.
   - Run `bun tsc --build --pretty false`, `bun run lint:architecture`,
     `bun run check:fast`, and `bun run test:postgres-concurrency` (whenever
     API transactions, locks, triggers, or isolation-sensitive reads change).
4. Measure the checkpoint and inspect tradeoffs:
   - Re-run the affected measurement suite (`perf:canaries`, `perf:inventory`,
     `perf:plans`, `perf:scenarios`, and any touched scaling probe).
   - Record the checkpoint with `bun run perf:epoch record --id <seq-slug> ...`
     and inspect `bun run perf:epoch analyze --from <prev> --to <curr>`.
   - Review every row under **Regressions** and **Tradeoffs Detected**. Either
     eliminate an unintended regression or document the explicit tradeoff in
     `--notes` and the PR body.
5. Ship via `ship-pr`:
   - Run independent review (`agent-tool review <harness>`), repair any
     `BLOCKER`/`MAJOR` findings, re-review, push with
     `agent-tool branch push <sha> --remote origin`, open PR referencing
     `Fixes #<issue>` when completely resolved, wait for CI, squash-merge,
     clean up with `reset`, and confirm `main` base health is green.

## Phase 4: Final Epoch Sweep & Closeout

After the last optimization PR merges:

1. Run the complete measurement suite on clean `main` (canaries, inventory,
   plans, scenarios, reload, realtime, rotations, baselines) and record the
   `--kind final` snapshot via `perf:epoch record`.
2. Inspect `bun run perf:epoch analyze --from 000-baseline --to <final>` and
   confirm `packages/performance/results/epoch-2/TRENDS.md` and `README.md`
   reflect the cumulative improvements, regressions, and tradeoffs.
3. Verify all target GitHub issues are closed, open issues via `open-issue` for
   any deferred bugs discovered during the scrub, update this skill with new
   lessons learned (keeping both `.agents/skills` and `.claude/skills` copies
   identical), and run `bun run agent-tool teardown`.
