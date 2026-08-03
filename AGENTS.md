# Multi-Agent Workflow Guide

## Preflight Commands

Run the smallest command that matches the handoff risk:

- `bun run check:fast`: formatting, OpenAPI generation and compatibility,
  bounded protocol models, package assertions, Knip, architecture, file names,
  source shape, binary-file, and Markdown checks.
- `bun run check:protocol-models`: all bounded TLC checks registered in
  `formal/protocol-models.txt`, using the Java and TLA+ tools pinned in
  `.mise.toml`.
- `bun run check:affected`: `check:fast`, TypeScript, and affected Turbo tests.
- `bun run check`: `check:fast`, TypeScript, and the full Turbo test suite.
- `bun run lint:knip:production`: production-only dependency and source reachability.
- `bun run report:dependencies:json`: dependency-cruiser diagnostics for
  architecture debugging.
- `bun run report:dependencies:mermaid`: graph output for quick dependency visualization.
- `bun run report:dependencies:archi`: collapsed Graphviz DOT output for
  package/module reports.

Use `bun run lint:source-shape -- --staged` before committing, and
`bun run lint:source-shape -- --range <base>..<head>` before handing off a
larger branch.

OpenAPI compatibility and protocol-model checks use mise-pinned tooling. Run
`mise install java github:oasdiff/oasdiff github:tlaplus/tlaplus` after cloning,
and fetch `origin/main` or set `OPENAPI_BASE_REF` when checking OpenAPI against
another base commit.

Intentional flag-day OpenAPI breaks may temporarily list an exact oasdiff
diagnostic in `scripts/checks/openApiCompatibilityErrors.ignore`. Each entry
must name its issue and removal condition in adjacent comments, and must be
deleted as soon as the default branch contains the new contract.

## Ownership Lanes

- `packages/api`: HTTP routes, service facades, workflow orchestration,
  persistence schema, and server adapters.
- `packages/api-client`: typed API client and request/response boundary helpers.
- `packages/client-sdk`: React-free client runtime, local persistence, sync,
  workflow facades, and public SDK exports.
- `packages/app`: React application shell, providers, stores, mini-apps,
  document projections, and product UI.
- `packages/app-web`, `packages/app-capacitor`, and `packages/app-electrobun`:
  deployment targets. Do not turn these into reusable libraries.
- `packages/crypto`, `packages/encoding`, `packages/loro`,
  `packages/sqlite-instance`, `packages/sqlite-worker`, `packages/validators`:
  lower-level support packages. Keep imports directed upward from apps into
  these packages, not back into apps.
- `packages/test-utils` and `packages/bob-and-alice`: test support only.
  Production source must not depend on them.
- `packages/ui`: product-neutral shared UI used by the website and app.
- `packages/website`: marketing/docs site. It may share UI, but must not import
  application implementation code.

## Dependency Direction

- API routes call services; services delegate transaction orchestration to
  workflows; workflows own access-plane composition.
- App presentation goes through stores/providers instead of importing
  persistence, SQLite, blob, contact, sync, or workflow internals directly.
- Client SDK data modules stay below client, store, and workflow facades.
- `@tearleads/validators`, `@tearleads/encoding`, and
  `@tearleads/sqlite-instance` are leaf-level support packages.
- `@tearleads/sqlite-worker` may depend on `@tearleads/sqlite-instance`, but not
  app, API, SDK, UI, or other support implementation code.
- `@tearleads/api-client` may share crypto and validator contracts, but must not
  import server, app, SDK, UI, or deployment implementation code.
- Production source must not import `@tearleads/test-utils` or
  `@tearleads/bob-and-alice`; keep shared test helpers in tests or documented
  test helper directories.
- Deployment target packages (`app-web`, `app-capacitor`, `app-electrobun`, and
  `website`) should consume shared packages and app facades, not import each
  other or become dependencies of reusable packages.
- Support packages must not import `packages/api`, `packages/app`,
  `packages/app-web`, `packages/app-capacitor`, `packages/app-electrobun`,
  `packages/client-sdk`, or `packages/website` implementation code unless an
  architecture rule explicitly allows it.
- Package-private source paths stay private unless they are exported in
  `package.json` and documented as public API.

## Subsystems

A **subsystem** is a stable proper noun for a slice of the system a developer
reasons about as one unit (e.g. `Containers`, `Realtime Sync`, `Access Plane &
Keying`). Use it in PRs and review to say where a feature lives and who owns it.

A subsystem is **descriptive, not a new enforcement axis**. It indexes paths
that already exist and may deliberately span several layers (`Containers` covers
its routes, its service facade, and its transaction-orchestration workflows).
Import direction stays enforced by the lanes/layers/planes in
`dependency-cruiser.config.ts`. The registry lives in `scripts/subsystems.ts`
and `docs/subsystems.md`; `bun run lint:architecture` fails if a production file
maps to zero or more than one subsystem, or if the manifest and docs drift.
Registered: `packages/api`, `packages/client-sdk`, and `packages/app`.

### Boundary vocabulary axes

These are distinct axes — do not conflate them:

- **Lane** — a package (`packages/<name>/src`); the coarsest ownership boundary.
- **Layer** — an intra-package directional tier (api `routes -> services ->
  workflows -> access`; app/SDK `data -> workflows -> stores -> presentation`).
- **Plane** — the api access read/write/shared split; a domain model, not a tree
  layout (see `docs/api-architecture.md`).
- **Facade** — a package's stable public seam (api `services/`, SDK
  `workflows/`, the `read/*.ts` + `write/*.ts` files).
- **Subsystem** — a vertical (or platform) slice's proper noun, layered
  descriptively over the above.

### Overloaded nouns (same word, different layer per package)

Three layer nouns mean different things depending on the package; read them by
their package, not the bare word:

- **workflow** — api: the _low_ transaction-orchestration layer **below**
  services. client-sdk: the _top_ public domain-operations facade. Opposite ends
  of the two stacks; the name is kept on both by decision.
- **store** — app: a React/UI state container. client-sdk: a headless,
  React-free state machine. api `access`: a low-level persistence sink.
- **runtime** — api `ApiServiceRuntime`: an infrastructure-injection dependency
  object. client-sdk: live client state + the workflow context value. app
  `AppRuntimeProvider`: the React provider aggregate.

## Generated And Build Output

Do not edit generated or build output directly:

- `dist/`, `build/`, `.turbo/`, `.astro/`, `playwright-report/`, `test-results/`
- `tsconfig.tsbuildinfo`
- SQLite wasm artifacts produced by `packages/sqlite-instance/scripts/buildSqliteMultipleCiphers.sh`
- Generated migration output unless the task is explicitly about schema
  migration generation

## Coordination Rules

- Keep changes inside one ownership lane when possible. If a change crosses
  lanes, explain the dependency direction in the PR body.
- Prefer small source files and focused modules. New or modified files are
  checked by `scripts/lintSourceShape.ts`.
- File-size, suppression, and approved barrel baselines live in `scripts/sourceShapeBaseline.json`.
- Do not grow an over-limit file as an incidental edit. Split by behavior,
  storage concern, workflow step, or UI subcomponent. If an over-limit file
  intentionally grows, update its line/byte budget in
  `scripts/sourceShapeBaseline.json` with reviewer context.
- Treat package root barrels and workflow facades as API policy. Add explicit
  named exports; new `export *` barrels must be added to the source-shape
  baseline intentionally.
- Do not add `biome-ignore`, `ts-ignore`, `ts-expect-error`, or TODO
  suppressions casually. The source-shape check tracks baseline growth.
- When changing public SDK exports, update `packages/client-sdk/package.json`,
  `packages/client-sdk/src/index.ts`,
  `packages/client-sdk/src/workflows/README.md`, and
  `docs/developer/client-sdk.md` together.
- When changing dependency topology, run `bun run lint:architecture` and inspect
  `bun run report:dependencies:json` if the failure is not obvious.
- When changing production dependencies, run both `bun run lint:knip:all` and
  `bun run lint:knip:production`.
