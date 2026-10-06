# @tearleads/client-sdk

The React-free Tearleads client runtime: local SQLite persistence, keys, sync,
encrypted blobs, and the domain workflows hosts build on. Hosts adapt platform
behavior into the SDK rather than duplicate its setup.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
| `@tearleads/client-sdk/testing` | Trusted-identity fixtures for integration tests; never production code |

## Quick start

```ts
import { Tearleads } from "@tearleads/client-sdk";

const tearleads = new Tearleads();
```

The minimal instance uses same-origin API routes, memory blob storage, default
logging, and an idle database. Configure SQLite before using persistence, sync,
or identity generation:

```ts
tearleads.database.configure({
  client: sqliteRuntime.client,
  id: sqliteRuntime.id,
});
```

`createSQLiteRuntime` from `@tearleads/client-sdk/sqlite` starts the runtime in
a module worker. The worker script is not part of this package: the host serves
it, at `/worker.js` unless it passes another `workerUrl`.

Typecheck with `skipLibCheck: true`: the declarations of drizzle-orm and
loro-crdt, which the SDK's types reference, do not typecheck without it.

The [developer guide](https://github.com/a2f0/tearleads/blob/main/docs/developer/client-sdk.md)
covers constructor options, the host contract, the local keyring, and every
public entry point.

## Publishing

Inside the workspace the package exports `dist/`, built by
`bun run --filter='@tearleads/client-sdk' build`. The npm package is built
separately, into a directory you name, with its own generated manifest:

```sh
bun run --cwd packages/client-sdk package <out-dir>  # build the npm package
bun run --cwd packages/client-sdk package:smoke      # pack, install, run, typecheck, and bundle outside the workspace
```

The workspace packages the SDK imports (`@tearleads/crypto`,
`@tearleads/validators`, and the rest) export TypeScript source and are not
published, so the build compiles them with the SDK, from its entry points, and
ships each one under `internal/<package>/`. Imports of them become relative
paths. Only modules the entry points reach are emitted, and only declarations
their types reach are kept. The npm dependencies are the packages that output
imports, at the versions the workspace pins, as caret ranges. Source maps carry
their sources inline and name them by file name alone.

`src/publishedPackage.test.ts` builds the package and checks its manifest, that
every module imports only its own files or a declared dependency, and that no
build path or test module ships. The smoke script imports every entry point
under Bun and Node and bundles them for the browser. It typechecks a consumer
under `bundler` and `nodenext` resolution with `skipLibCheck: true`, then again
without it, failing on errors in the SDK's declarations and ignoring those in
drizzle-orm's and loro-crdt's own. It needs the network to install the
consumer's dependencies.

Merging to `main` publishes. When `packages/client-sdk` changes there,
`.github/workflows/client-sdk-publish.yml` publishes the version in
`package.json` if it is newer than npm's `latest`, after running the smoke
script; a merge that leaves the version alone, a re-run, or a run that finishes
after a newer release succeeds without publishing
(`scripts/lib/npmPublishDecision.ts` makes that call). Because the package
ships the workspace packages above, `agent-tool.json` lists it under
`versions.bundles`: a change to any of them also bumps the SDK's version, so it
publishes too. The workflow authenticates with
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and
attaches provenance to each version. On npmjs.com the package's trusted
publisher names the `a2f0` owner, the `tearleads` repository, the
`client-sdk-publish.yml` workflow, and the `npm` environment, which the
repository restricts to `main`. Renaming the workflow or the environment breaks
publishing until that setting matches.

To publish by hand instead, run from the repository root with an account that
owns the `@tearleads` npm scope:

```sh
npm login --registry https://registry.npmjs.org
bun run publish:npm:dry-run client-sdk
bun run publish:npm client-sdk --otp 123456
```

`scripts/publishNpmPackage.sh` rebuilds into a fresh temporary directory,
publishes its generated manifest with public access to
`https://registry.npmjs.org`, and removes the directory on success or failure.
A temporary `.npmrc` overrides any scope-specific registry without changing
your npm configuration. It accepts `--dry-run`, `--tag <tag>` (default
`latest`), and `--otp <code>`.

`ship-pr` bumps changed workspace packages before review and merge; the
generated manifest copies `version` from `package.json`. The manifest names
this repository, which npm requires of a version with provenance, and declares
`"license": "UNLICENSED"` until a license is chosen.
