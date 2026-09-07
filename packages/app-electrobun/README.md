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

Run `bun run --cwd packages/app-electrobun dev` to start the desktop app, or
`bun run --cwd packages/app-electrobun build:dev` to build it. The main process
continues to use Bun. Renderer settings are explicit build-time defines:
`BUN_PUBLIC_API_BASE_URL` defaults to localhost, `BUN_PUBLIC_WS_URL` defaults to
the backend events endpoint, and the build wrapper stamps
`BUN_PUBLIC_APP_VERSION` and `BUN_PUBLIC_GIT_SHA`. Unset settings compile to
`undefined`, so a WebView never needs a Node `process` global.

See [dependency upgrade notes](../../docs/dependency-upgrades.md) and the
[Electrobun migration guide](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/migrating-to-v2.mdx)
when changing the toolchain.
