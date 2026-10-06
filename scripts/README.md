# Repository scripts

The top level holds commands you run directly: local app launchers, release
builds and uploads, deployments, screenshots, backups, and maintenance tools.
For example, run `./scripts/runApp.sh`, `./scripts/buildIosRelease.sh`, or
`./scripts/deployStaging.sh` from the repository root.

For website-only deployments, run `./scripts/deployStagingWebsite.sh` or
`./scripts/deployProductionWebsite.sh`. Both use the shared deployment helper in
`packages/website/scripts/deployWebsite.sh`; see the
[website deployment guide](../packages/website/README.md) for credentials and
dry-run options.

`publishNpmPackage.sh` publishes a package to npm by its directory name:
`windowing` or `client-sdk`. Each package's workflow runs it when a version
bump merges, after `lib/npmPublishDecision.ts` checks the version is new. To
publish by hand, run `bun run publish:npm:dry-run <package>` to
build and preview it, then `bun run publish:npm <package>` to publish it; both
also accept `--tag <tag>` and `--otp <code>`. See the
[windowing](../packages/windowing/README.md#publishing) and
[client SDK](../packages/client-sdk/README.md#publishing) publishing guides for
authentication, versioning, and consumer smoke checks.

Automated checks and supporting code live in subfolders. Use the root
`package.json` commands, such as `bun run check:fast`, `bun run lint:architecture`,
or `bun run test:static-analysis`, to run checks and tooling tests.

| Folder | Contents |
| --- | --- |
| `architecture/` | Architecture checks and reports, dependency rules, workspace and subsystem registries. |
| `checks/` | Check entry points, static analysis helpers, baselines, and regression fixtures. |
| `git/` | Hook installation, hook implementations, and push timing reports. |
| `keychain/` | Manual macOS keychain utilities. |
| `lib/` | Shared shell functions and build helpers called by other scripts, with their tests. |
| `localstack/` | Local S3 setup, shutdown, and reset commands. |
| `postgres/` | Development database setup, migration, and reset commands. |
| `protocol/` | Formal protocol checks, trace generation and projection, negative controls, and their tests. |
| `testing/` | Test runners used by package scripts and automated checks. |

## Verification harness

`bun run check` and `bun run check:affected` use the same verification runner.
They retain their existing build, TypeScript, static-check, and full or affected
Turbo test steps. Builds finish before tests begin; `build:packages` prepares
SQLite, the client SDK, and the Electrobun devkit.

For focused tests, select the exact workspace name from its `package.json`:

```sh
bun run check:package @tearleads/api
bun run check:package app --test-name-pattern 'folder recovery'
bun run check:package @tearleads/client-sdk
```

This command runs `build:packages`, then the selected workspace's `test` script.
Additional arguments go to that script as separate arguments, including patterns
with spaces. The API script still tests both database backends. Package mode
does not run TypeScript, static checks, or browser E2E tests; use `check:affected`
or `check` for a handoff. Dependencies must already be installed; the runner does
not install tools or change the lockfile.

Each run prints the path to a JSON report under the checkout's Git directory:
`git rev-parse --git-path verification` locates the report directory, including
in linked worktrees. Reports record the mode, package, starting and ending Git
commit/tree IDs, working-tree status and content fingerprints, commands, step
durations, exit codes, and skipped steps after a failure. Dirty worktrees are
supported and identified in the report. A changed revision or source fingerprint
fails the run, even when all commands succeeded.

Reports are saved before and after each step. An abruptly killed process leaves
a `running` report rather than a successful result. Each run has its own file,
and reports are local evidence rather than a replacement for CI. Avoid editing
source or running concurrent builds/tests while a verification run is active:
the SDK build replaces output that dependent tests consume.

## Adding a script

- Keep a command at the top level when it is intended to be run directly for
  development, releases, deployment, or maintenance.
- Put shared shell functions and internal command wrappers in `lib/`.
- Keep domain-specific helpers and tests beside their tooling in `checks/`,
  `architecture/`, or `protocol/`; put test launchers in `testing/`.
- Wire automated commands through the root `package.json`. When moving a file,
  update its imports, shell source paths, test fixtures, documentation, and Turbo
  inputs together.

Windows desktop releases use `./scripts/windowsRelease.sh build staging` or
`build production` to dispatch GitHub Actions. After the run completes, use
`download <tier> <run-id>` to retrieve its package or `upload <tier> <run-id>`
to publish it to S3 with local credentials. See the
[Windows release guide](../packages/app-electrobun/README.md#windows-releases-from-github-actions).
