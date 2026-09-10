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

Linux builds bundle Electrobun's CEF renderer. The system WebKitGTK renderer can
omit worker OPFS APIs required by the encrypted SQLite SyncAccessHandle Pool;
CEF provides a consistent persistent-storage backend across Linux installations.

On a Linux desktop, exercise that native boundary and a real process restart:

```sh
bun run --cwd packages/app-electrobun test:linux-persistence
```

The smoke test builds the dev bundle, launches bundled CEF twice with an
isolated home directory, exercises the database worker's real OPFS
sync-access-handle backend, and confirms the populated identity database reopens
after relaunch.

See [dependency upgrade notes](../../docs/dependency-upgrades.md) and the
[Electrobun migration guide](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/migrating-to-v2.mdx)
when changing the toolchain.
