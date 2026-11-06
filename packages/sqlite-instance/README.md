# @tearleads/sqlite-instance

The SQLite3 Multiple Ciphers WebAssembly build that every client database runs
on. The package pins the release (`SQLITE3MC_VERSION` and `SQLITE_VERSION` in
`src/index.ts`), downloads it, and exposes the files to the
[SQLite worker](../sqlite-worker/README.md). It is a leaf package: it imports
no other workspace package.

## Build

```sh
bun run --cwd packages/sqlite-instance build
```

`scripts/buildSqliteMultipleCiphers.sh` downloads the pinned release archive
from GitHub, checks its SHA-256, and extracts it into the ignored
`dist/jswasm/`. A version stamp skips the download when the same archive is
already in place. Root `bun run build:packages` runs this step. Do not edit
`dist/` by hand.

To upgrade, change the versions and archive hash in the script and in
`src/index.ts` together, then follow the
[dependency upgrade guide](../../docs/dependency-upgrades.md): the worker's
encrypted-database fixture must still open under the new runtime.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/sqlite-instance` | Version constants and the SQLite type definitions |
| `@tearleads/sqlite-instance/assets` | `getSqliteWasmAssetUrl` and `getSqliteLicensesUrl` |
| `@tearleads/sqlite-instance/jswasm/sqlite3.mjs` | The module a worker initializes SQLite from |
| `@tearleads/sqlite-instance/jswasm/*` | The other downloaded files, `sqlite3.wasm` included |

## Licenses

Anything that ships the WebAssembly files ships [LICENSES.md](LICENSES.md)
with them.
