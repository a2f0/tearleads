# Repository scripts

Commands are grouped by purpose. Root `package.json` scripts are the stable
entrypoints for automated checks, builds, and publishing, such as
`bun run check:fast`, `bun run lint:architecture`, or
`bun run test:static-analysis`. Direct shell shortcuts live in the groups
below; run them from the repository root, for example
`./scripts/dev/runApp.sh`, `./scripts/release/buildIosRelease.sh`, or
`./scripts/deploy/deployStaging.sh`.

| Folder | Contents |
| --- | --- |
| `admin/` | Explicit operational utilities, including blob-bucket inspection. |
| `architecture/` | Architecture checks and reports, dependency rules, workspace and subsystem registries. |
| `checks/` | Check entry points, static analysis helpers, baselines, and regression fixtures. |
| `deploy/` | Tier and website deployments, teardown, and their shared helpers. |
| `dev/` | Local launchers, shell setup, seed generation, and cache maintenance. |
| `git/` | Hook installation, hook implementations, and push timing reports. |
| `keychain/` | Manual macOS keychain utilities. |
| `lib/` | Helpers shared across script groups, including timings, build metadata, and release environment guards. |
| `localstack/` | Local S3 setup, shutdown, and reset commands. |
| `postgres/` | Development database setup, migration, and reset commands. |
| `protocol/` | Formal protocol checks, trace generation and projection, negative controls, and their tests. |
| `release/` | Native and desktop release builds/uploads, npm publishing, and their helpers and tests. |
| `testing/` | Test runners, screenshots, device-test launchers, and verification evidence. |

## Scope evaluations

For repository discoverability probes with Claude Code and a Codex Judge, see
the [Scope setup guide](../docs/developer/scope.md). Reusable tooling and benchmark
definitions live in `scripts/dev/scope/`; local state and artifacts stay in the
ignored `.scope/` directory. `bun run scope install`, `start`, and `portal` manage
the local stack. `bun run scope:register` uploads committed source; `calibrate`
checks the Judge and `benchmark` runs the three inspection tasks.

## Deployment and release shortcuts

For website-only deployments, run `./scripts/deploy/deployStagingWebsite.sh` or
`./scripts/deploy/deployProductionWebsite.sh`. Both use the shared helper in
`packages/website/scripts/deployWebsite.sh`; see the
[website deployment guide](../packages/website/README.md) for credentials and
dry-run options.

Windows desktop releases use `./scripts/release/windowsRelease.sh build staging`
or `build production` to dispatch GitHub Actions. After the run completes, use
`download <tier> <run-id>` to retrieve its package or `upload <tier> <run-id>`
to publish it to R2 with local credentials. See the
[Windows release guide](../packages/app-electrobun/README.md#windows-releases-from-github-actions).

`release/publishNpmPackage.sh` publishes a package to npm by its directory name:
`windowing` or `client-sdk`. Each package's publish workflow runs it when a
version bump merges, after `agent-tool release plan --allow-private-source`
confirms the version is new; the flag is needed because these private
workspaces build public consumer manifests. To publish by hand, run
`bun run publish:npm:dry-run <package>` to build and preview it, then
`bun run publish:npm <package>` to publish it; both also accept `--tag <tag>`
and `--otp <code>`. See the
[windowing](../packages/windowing/README.md#publishing) and
[client SDK](../packages/client-sdk/README.md#publishing) publishing guides for
authentication, versioning, and consumer smoke checks.

## Screenshot seed and capture

`bun run screenshots:seed` verifies the pinned Continuity manifest, validates
its versioned seed contract, and builds `tearleads-seed.tlbackup.json` through
the SDK. The adjacent `.provenance.json` binds the backup to the seed and screenshot
expectations. Both are local artifacts. A direct Playwright capture rejects a
missing or stale provenance; regenerate with `bun run screenshots:seed`.

`bun run screenshots` regenerates that backup and restores it through the app
before capturing desktop, tablet, and phone layouts in both themes. Household
detail captures assert decoded family/equipment photos and receipts, inventory
fields, and tracker table rows and graph points. The browser locale and time
zone are pinned so the dated readings render consistently.
It writes below the gitignored `.screenshots`, which links to the
`matrix-artifacts` store shared by every clone. `bun run build:website` only
stages the existing captures into the website gallery; it never captures (see
[local website screenshots](../packages/website/README.md#local-website-screenshots)).

Add canonical facts and photographic assets in
[a2f0/continuity](https://github.com/a2f0/continuity), regenerate and ship them
there, then update the root catalog commit pin and run `bun install`. The
contract test in `packages/app/test/screenshot-seed/continuitySeed.test.ts`
builds and restores the pinned data into a separate database and blob store.
Tracker `rows` go through `addRow`; repeated `equipment-photos` entries append
independent images, while single-image attachment slots reject duplicates.

Tracker seeds preserve Continuity’s recorded wall-clock time when converting
offset-bearing timestamps to the app’s `datetime-local` fields. The restore
test verifies that every seeded reading is accepted by the chart parser.

## Verification

Use `bun run check`, `bun run check:affected`, or `bun run check:package` for
repository verification. The
[verification guide](../docs/developer/verification.md) describes build
prerequisites, Turbo task evidence, command capture, and checkout-bound reports.
`build:runtime` builds SQLite and the SDK for focused API/SDK checks;
`build:packages` adds the desktop devkit for broader repository checks.

## Adding a script

- Put commands in the purpose-specific group above, even when invoked directly.
- Use agent-tool for shared Git, GitHub, hook installation, binary checks, CI
  aggregation, and npm release decisions. Keep repository policy, path
  classification, application checks, and release orchestration here.
- Keep helpers and their tests beside their owning commands, including domain
  groups such as `architecture/` and `protocol/`. Reserve `lib/` for helpers
  shared across groups, and put test launchers in `testing/`.
- Native platform scripts stay with their package; Terraform scripts stay in
  the infrastructure tree.
- Wire automated commands through the root `package.json`. When moving a file,
  update its imports, shell source paths, test fixtures, documentation, and Turbo
  inputs together.
