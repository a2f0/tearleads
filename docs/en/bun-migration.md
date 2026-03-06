# Bun Migration (Phase 1)

This repo is currently migrating in phases toward Bun.

## Current status

- `pnpm` remains the default package manager.
- Selected runtime scripts now support `pnpm` or `bun` via `scripts/tooling/pm.sh`.
- `bun test` is not yet a full replacement for the existing Vitest suite.

## Package manager selector

Use `TEARLEADS_PM` to override package manager selection for supported scripts:

```sh
# default behavior (pnpm if installed, else bun)
./scripts/runElectron.sh

# force bun
TEARLEADS_PM=bun ./scripts/runElectron.sh

# force pnpm
TEARLEADS_PM=pnpm ./scripts/runElectron.sh
```

Supported values:

- `pnpm`
- `bun`

## Benchmark command

Run representative test timings across `pnpm + vitest`, `bunx + vitest`, and `bun test`:

```sh
pnpm benchmarkBunMigration
```

Optional repeats:

```sh
BENCH_REPEATS=3 pnpm benchmarkBunMigration
```

## Notes

- The benchmark includes a Node-only `bun test` sample.
- Some repo tests currently depend on Vitest-specific APIs and jsdom setup, so migration to `bun test` will be package-by-package.
