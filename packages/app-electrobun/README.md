# Desktop development

After `bun install --frozen-lockfile` at the repository root, prepare the SDK
before opening this package in an editor or invoking TypeScript directly:

```sh
bun run --cwd packages/app-electrobun prepare:devkit
```

Electrobun 2's npm version selects its paired Hutch toolchain and SDK. The first
command downloads and verifies that toolchain, then projects the SDK into the
ignored `.hutch/devkit/` directory. Its TypeScript config must exist before the
editor or `tsc` resolves the package. Root `build:packages` and `check:fast` prepare
it automatically. The repository's TypeScript rules take precedence over the
SDK config; the package lists its vendor compatibility exceptions explicitly.

The pinned npm package selects Hutch 0.24.3 for Electrobun 2.0.1. Its
[bootstrap](https://github.com/blackboardsh/electrobun/blob/v2.0.1/npm/electrobun/bin/resolve-hutch.cjs)
checks the release index's archive size and SHA-256, then validates cached
launcher/engine hashes. It reuses `~/.hutch/` on subsequent runs. After the first
setup, `DASH_RELEASE_OFFLINE=1 bun run --cwd packages/app-electrobun prepare:devkit`
works without downloading; this was verified during the upgrade. A fresh CI
runner downloads the paired release once, like the other mise-managed tools.
Deleting `.hutch/devkit/` requires rerunning preparation before standalone
`bun tsc --build` or `bun run lint:knip:all` / `bun run lint:knip:production`.

Run `./scripts/runElectrobun.sh` from the repository root (or
`bun run --cwd packages/app-electrobun dev`) to start the desktop app. Arguments
such as `--reset` are forwarded to the package launcher. Use
`bun run --cwd packages/app-electrobun build:dev` to build it. The main process
continues to use Bun. Renderer settings are explicit build-time defines:
`BUN_PUBLIC_API_BASE_URL` defaults to localhost, `BUN_PUBLIC_WS_URL` defaults to
the backend events endpoint, and the build wrapper stamps
`BUN_PUBLIC_APP_VERSION` and `BUN_PUBLIC_GIT_SHA`. Unset settings compile to
`undefined`, so a WebView never needs a Node `process` global.

Linux and Windows builds bundle and use Electrobun's pinned CEF renderer. On
Windows, this pins Chromium to the app release independently of the machine's
WebView2 installation and update cycle. macOS builds use the native WKWebView
and explicitly disable CEF bundling. These settings apply to both development
and release builds in `electrobun.config.ts`.

The repository's [pre-deployment policy](../../docs/request-budget-closeout.md)
has no legacy production clients to support; this Windows renderer choice
establishes the release baseline. Local WebView2 development profiles remain
separate from CEF profiles and are not migrated by this configuration.

The packaging step emits the renderer HTML and assets together with Bun and
embeds Loro's WASM, alongside the SQLite worker and WASM. Both packaged and
development apps use `http://127.0.0.1:3002` so OPFS and localStorage retain the
same origin after a restart.

## macOS releases

Build locally on an Apple silicon Mac with Xcode, ImageMagick, Bun, and the AWS
CLI installed. These scripts load `.secrets/root.env` plus the selected tier's
environment file and select its API, WebSocket, Sentry, and download bucket.

```sh
scripts/buildMacosRelease.sh staging
scripts/buildMacosRelease.sh production

# Build, sign, notarize, verify, and upload to the matching S3 bucket:
scripts/uploadMacosRelease.sh staging
scripts/uploadMacosRelease.sh production
```

Equivalent package commands are `build:staging`, `build:release`,
`upload:staging`, and `upload:release`. Each upload command builds fresh artifacts
before publishing. Staging uses Electrobun's `canary` channel and production uses
`stable`; the apps have separate channel data directories.

Signing uses the installed Developer ID Application identity. Set
`ELECTROBUN_DEVELOPER_ID` if more than one is installed. Notarization uses
`APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and
`.secrets/AuthKey_<key-id>.p8`, matching the existing iOS credentials. The
`ELECTROBUN_APPLEAPIKEY`, `ELECTROBUN_APPLEAPIISSUER`, and
`ELECTROBUN_APPLEAPIKEYPATH` variables can override those values. The private key
must be accessible to `codesign`; the existing
`scripts/keychain/authorizeCodesignPartitionList.sh` helper runs in the owner's
interactive Terminal when macOS requires keychain authorization.

The `postBuild` hook packages the final renderer, Loro WASM, SQLite worker, and
SQLite WASM before Electrobun signs or archives the app. Release icons come from
the shared Tearleads SVG. Artifacts and SHA-256 checksums are written to the
ignored `build/artifacts/` directory. Uploads publish DMGs, matching checksums,
and full update archives under
immutable filenames containing their SHA-256 digests. Update and download
discovery documents are replaced only after all payloads succeed, so a failed
upload preserves previously published releases. Discovery uses revalidating
cache headers; immutable artifacts may be cached for a year.
Delta patches are disabled; full update archives are published with each build.

| Tier | Bucket | Local installer |
| --- | --- | --- |
| Production | `downloads.tearleads.com` | `macos-arm64-Tearleads.dmg` |
| Staging | `downloads-staging.tearleads.com` | `canary-macos-arm64-Tearleads-canary.dmg` |

Redeploy the website after publishing: its build resolves the environment's
`<channel>-macos-arm64-download.json` into a matched pair of immutable installer
and checksum links. An unavailable discovery document falls back to the verified
first release. Existing legacy filenames are retained and never overwritten by
this publisher. These local scripts publish macOS ARM64 only. See
[Electrobun distribution](https://framework.blackboard.sh/electrobun/guides/bundling-and-distribution/)
for platform packaging and native runner requirements.

Run `bun run --cwd packages/app-electrobun test:release-packaging` on an
Apple silicon Mac after preparing the devkit to exercise the real native
packaging pipeline in a temporary project. It verifies the final renderer and
SQLite assets in the update archive, and confirms a failed packaging hook stops
before signing or artifact creation. It also publishes through a fake S3 command
and uses Electrobun's actual updater to validate the manifest, resolve and read
the published archive, and check its build hash. This probe uses no signing
or AWS credentials.

## Native persistence checks

On Windows, exercise the native build and encrypted identity database restart:

```sh
bun run --cwd packages/app-electrobun test:windows-persistence
```

The Windows CEF persistence CI job runs this check on a native Windows runner.
It verifies bundled CEF selection and reuses the Linux storage probe to confirm
that a populated encrypted identity database reopens after a process restart
and a nested-route reload.
The local test requires Bun and Git Bash and isolates storage in a temporary
`LOCALAPPDATA` directory.

On Linux, the system WebKitGTK renderer can omit worker OPFS APIs required by
the encrypted SQLite SyncAccessHandle Pool; CEF provides a consistent
persistent-storage backend across Linux installations.

On a Linux desktop, exercise that native boundary and a real process restart:

```sh
bun run --cwd packages/app-electrobun test:linux-persistence
```

The smoke test builds the dev bundle, launches bundled CEF twice with an
isolated home directory, exercises the database worker's real OPFS
sync-access-handle backend, and confirms the populated identity database reopens
after relaunch.

Both smoke tests use CEF's development DevTools endpoint. Electrobun 2.0.1
[disables remote debugging by default for canary and stable builds](https://github.com/blackboardsh/electrobun/blob/v2.0.1/package/src/native/shared/chromium_flags.test.cpp#L23).

See [dependency upgrade notes](../../docs/dependency-upgrades.md) and the
[Electrobun migration guide](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/migrating-to-v2.mdx)
when changing the toolchain.
