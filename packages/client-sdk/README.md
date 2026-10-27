# @tearleads/client-sdk

The React-free Tearleads client runtime: local SQLite persistence, keys, sync,
encrypted blobs, and the domain workflows hosts build on. Hosts adapt platform
behavior into the SDK rather than duplicate its setup.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
| `@tearleads/client-sdk/sqlite/worker.js` | The SQLite worker module to serve |
| `@tearleads/client-sdk/sqlite/sqlite3.wasm` | The SQLite WebAssembly to serve beside `worker.js` |
| `@tearleads/client-sdk/sqlite/sqlite3-licenses.md` | The licenses that ship with the two SQLite files |
| `@tearleads/client-sdk/testing` | Trusted-identity fixtures for integration tests; never production code |

## Quick start

```ts
import { Tearleads } from "@tearleads/client-sdk";

const tearleads = new Tearleads();
```

The minimal instance uses same-origin API routes, memory blob storage, default
logging, and an idle database. Initialize SQLite, then configure the SDK before
using persistence, sync, or identity generation. Here `localKeys` comes from the
host's [local keyring](https://github.com/a2f0/tearleads/blob/main/docs/developer/client-sdk.md#local-keyring):

```ts
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";

const sqliteRuntime = createSQLiteRuntime();
await sqliteRuntime.client.init({
  dbName: "/app-identity.db",
  cipher: "chacha20",
  key: localKeys.sqliteKey,
  persistence: "opfs-sahpool",
});
tearleads.database.configure({
  client: sqliteRuntime.client,
  id: sqliteRuntime.id,
});
```

`createSQLiteRuntime` runs SQLite in a module worker that it starts from
`/worker.js`, or from the URL you pass as `workerUrl`. Serve the package's
SQLite files from your app's origin, side by side: the worker loads
`sqlite3.wasm` from beside itself, with the `application/wasm` content type.
Ship `sqlite3-licenses.md` with them. For example, in a build script:

```ts
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

for (const file of ["worker.js", "sqlite3.wasm", "sqlite3-licenses.md"]) {
  const source = import.meta.resolve(`@tearleads/client-sdk/sqlite/${file}`);
  await copyFile(fileURLToPath(source), `public/${file}`);
}
```

SQLite defaults to `persistence: "memory"`, which loses the database on worker
restart or page reload. The example opts into `"opfs-sahpool"` to persist it in
the origin private file system (OPFS); serve the page from a secure context.
If OPFS is unavailable, initialization fails instead of falling back to memory.

Typecheck with `skipLibCheck: true`: the declarations of drizzle-orm and
loro-crdt, which the SDK's types reference, do not typecheck without it.

When restoring a session with `tearleads.session.setContext`, restore its
`userId` together with its token. Automatic renewal replays an expired request
only when the original user is known and login authenticates that same user.
A login with a different or previously unknown user may install its new session,
but cannot authorize replay of the old request.

The [developer guide](https://github.com/a2f0/tearleads/blob/main/docs/developer/client-sdk.md)
covers constructor options, the host contract, the local keyring, and every
public entry point.
For document editing and creation, start with the
[document creation guide](https://github.com/a2f0/tearleads/blob/main/docs/developer/document-creation.md).

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
their types reach are kept. The SQLite worker files come from the same
`scripts/buildSqliteWorker.ts` the workspace build runs, which every Tearleads
host copies, so npm consumers serve the worker the apps run. The npm
dependencies are the packages that output imports, at the versions the
workspace pins, as caret ranges. Source maps carry their sources inline and
name them by file name alone.

`scripts/publishedPackage.test.ts` builds the package and checks its manifest,
that every module imports only its own files or a declared dependency, and that
no build path or test module ships. The smoke script imports every entry point
under Bun and Node, resolves and parses the SQLite worker files, and bundles
the entry points for the browser. It typechecks a consumer under `bundler` and
`nodenext` resolution with `skipLibCheck: true`, then again without it, failing
on errors in the SDK's declarations and ignoring those in drizzle-orm's and
loro-crdt's own. It needs the network to install the consumer's dependencies.

Merging to `main` publishes. When `packages/client-sdk` changes there,
`.github/workflows/client-sdk-publish.yml` publishes the version in
`package.json` if it is a stable `x.y.z` newer than npm's `latest`, after the
smoke script passes. A merge that leaves the version alone, a re-run, or a run
that finishes after a newer release succeeds without publishing
(`agent-tool release plan` makes that call). Because the package ships the
workspace packages above, `agent-tool.json` lists it under `versions.bundles`:
a change to any of them also bumps the SDK's version, so it publishes too.

The workflow authenticates with
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

`scripts/release/publishNpmPackage.sh` rebuilds into a fresh temporary
directory, publishes its generated manifest with public access to
`https://registry.npmjs.org`, and removes the directory on success or failure.
A temporary `.npmrc` overrides any scope-specific registry without changing
your npm configuration. It accepts `--dry-run`, `--tag <tag>` (default
`latest`), and `--otp <code>`.

The generated manifest copies `version` from `package.json`, names this
repository (npm requires that of a version with provenance), and declares
`"license": "UNLICENSED"`.
