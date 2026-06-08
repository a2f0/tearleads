# Multi-Agent Workflow Guide

## Preflight Commands

Run the smallest command that matches the handoff risk:

- `bun run check:fast`: formatting, package assertions, Knip, architecture, file names, source shape, and binary-file checks.
- `bun run check:affected`: `check:fast`, TypeScript, and affected Turbo tests.
- `bun run check`: `check:fast`, TypeScript, and the full Turbo test suite.
- `bun run lint:knip:production`: production-only dependency and source reachability.
- `bun run report:dependencies:json`: dependency-cruiser diagnostics for architecture debugging.
- `bun run report:dependencies:mermaid`: graph output for quick dependency visualization.
- `bun run report:dependencies:archi`: collapsed Graphviz DOT output for package/module reports.

Use `bun run lint:file-limits --staged` before committing and `bun run lint:file-limits --range <base>..<head>` before handing off a larger branch.

## Ownership Lanes

- `packages/api`: HTTP routes, service facades, workflow orchestration, persistence schema, and server adapters.
- `packages/api-client`: typed API client and request/response boundary helpers.
- `packages/client-sdk`: React-free client runtime, local persistence, sync, workflow facades, and public SDK exports.
- `packages/app`: React application shell, providers, stores, mini-apps, document projections, and product UI.
- `packages/app-web` and `packages/app-electrobun`: deployment targets. Do not turn these into reusable libraries.
- `packages/crypto`, `packages/encoding`, `packages/loro`, `packages/sqlite-instance`, `packages/sqlite-worker`, `packages/validators`: lower-level support packages. Keep imports directed upward from apps into these packages, not back into apps.
- `packages/test-utils` and `packages/bob-and-alice`: test support only. Production source must not depend on them.
- `packages/ui`: product-neutral shared UI used by the website and app.
- `packages/website`: marketing/docs site. It may share UI, but must not import application implementation code.

## Dependency Direction

- API routes call services; services delegate transaction orchestration to workflows; workflows own access-plane composition.
- App presentation goes through stores/providers instead of importing persistence, SQLite, blob, contact, sync, or workflow internals directly.
- Client SDK data modules stay below client, store, and workflow facades.
- `@tearleads/validators`, `@tearleads/encoding`, and `@tearleads/sqlite-instance` are leaf-level support packages.
- `@tearleads/sqlite-worker` may depend on `@tearleads/sqlite-instance`, but not app, API, SDK, UI, or other support implementation code.
- `@tearleads/api-client` may share crypto and validator contracts, but must not import server, app, SDK, UI, or deployment implementation code.
- Production source must not import `@tearleads/test-utils`; keep shared test helpers in tests or documented test helper directories.
- Deployment target packages (`app-web`, `app-electrobun`, and `website`) should consume shared packages and app facades, not import each other or become dependencies of reusable packages.
- Support packages must not import `packages/api`, `packages/app`, `packages/app-web`, `packages/app-electrobun`, `packages/client-sdk`, or `packages/website` implementation code unless an architecture rule explicitly allows it.
- Package-private source paths stay private unless they are exported in `package.json` and documented as public API.

## Generated And Build Output

Do not edit generated or build output directly:

- `dist/`, `build/`, `.turbo/`, `.astro/`, `playwright-report/`, `test-results/`
- `tsconfig.tsbuildinfo`
- SQLite wasm artifacts produced by `packages/sqlite-instance/scripts/buildSqliteMultipleCiphers.sh`
- Generated migration output unless the task is explicitly about schema migration generation

## Coordination Rules

- Keep changes inside one ownership lane when possible. If a change crosses lanes, explain the dependency direction in the PR body.
- Prefer small source files and focused modules. New or modified files are checked by `scripts/checks/checkFileLimits.sh`.
- Do not grow an over-limit file as an incidental edit. Split by behavior, storage concern, workflow step, or UI subcomponent.
- Treat package root barrels and workflow facades as API policy. Add explicit named exports; avoid new unreviewed `export *` barrels.
- When changing public SDK exports, update `packages/client-sdk/package.json`, `packages/client-sdk/src/index.ts`, `packages/client-sdk/src/workflows/README.md`, and `docs/developer/client-sdk.md` together.
- When changing dependency topology, run `bun run lint:architecture` and inspect `bun run report:dependencies:json` if the failure is not obvious.
- When changing production dependencies, run both `bun run lint:knip:all` and `bun run lint:knip:production`.
