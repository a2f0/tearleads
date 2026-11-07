# Architecture vocabulary

Review and PR descriptions name boundaries along several distinct axes. Do not
conflate them. [Subsystems](../subsystems.md) are the registered proper nouns;
[`dependency-cruiser.config.ts`](../../dependency-cruiser.config.ts) enforces
import direction across lanes, layers, and planes.

## Boundary vocabulary axes

- **Lane** — a package (`packages/<name>/src`); the coarsest ownership boundary.
- **Layer** — an intra-package directional tier (api `routes -> services ->
  workflows -> access`; app/SDK `data -> workflows -> stores -> presentation`).
- **Plane** — the api access read/write/shared split; a domain model, not a tree
  layout (see [API architecture](../api-architecture.md)).
- **Facade** — a package's stable public seam (api
  [`services/`](../../packages/api/src/services/), SDK
  [`workflows/`](../../packages/client-sdk/src/workflows/), the `*.ts` files in
  [`packages/api/src/access/read/`](../../packages/api/src/access/read/) and
  [`packages/api/src/access/write/`](../../packages/api/src/access/write/)).
- **Subsystem** — a vertical (or platform) slice's proper noun, layered
  descriptively over the above.

## Overloaded nouns

The same word names a different layer per package. Read these layer nouns by
their package:

- **workflow** — api: the _low_ transaction-orchestration layer **below**
  services. client-sdk: the _top_ public domain-operations facade. Opposite ends
  of the two stacks; the name is kept on both.
- **store** — app: a React/UI state container. client-sdk: a headless,
  React-free state machine. api `access`: a low-level persistence sink.
- **runtime** — api `ApiServiceRuntime`: an infrastructure-injection dependency
  object. client-sdk: live client state + the workflow context value. app
  `AppRuntimeProvider`: the React provider aggregate.
