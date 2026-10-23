# Repository scripts

Commands are grouped by purpose. Package scripts are the stable entrypoints
for automated checks, builds, and publishing; direct shell shortcuts live in
the groups below.
For example, run `./scripts/dev/runApp.sh`,
`./scripts/release/buildIosRelease.sh`, or
`./scripts/deploy/deployStaging.sh` from the repository root.

For website-only deployments, run `./scripts/deploy/deployStagingWebsite.sh` or
`./scripts/deploy/deployProductionWebsite.sh`. Both use the shared deployment
helper in
`packages/website/scripts/deployWebsite.sh`; see the
[website deployment guide](../packages/website/README.md) for credentials and
dry-run options.

`release/publishNpmPackage.sh` publishes a package to npm by its directory name:
`windowing` or `client-sdk`. Each package's workflow runs it when a version
bump merges, after `release/npmPublishDecision.ts` checks the version is new. To
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

## Screenshot seed and capture

`bun run screenshots:seed` verifies the pinned Continuity manifest, validates its
versioned seed contract, and builds `tearleads-seed.tlbackup.json` through the SDK.
The adjacent `.provenance.json` binds the backup to the seed and screenshot
expectations. Both are local artifacts. A direct Playwright capture rejects a
missing or stale provenance; regenerate with `bun run screenshots:seed`.

`bun run screenshots` regenerates that backup and restores it through the app
before capturing desktop, tablet, and phone layouts in both themes. Household
detail captures assert decoded family/equipment photos and receipts, inventory fields,
and tracker table rows and graph points. The browser locale and time zone are
pinned so the dated readings render consistently. `bun run build:website` also
stages these captures into the website gallery.

Add canonical facts and photographic assets in [a2f0/continuity](https://github.com/a2f0/continuity),
regenerate and ship them there, then update the root catalog commit pin and run
`bun install`.
The contract test in `packages/app/test/screenshot-seed/continuitySeed.test.ts`
builds and restores the pinned data into a separate database and blob store.
Tracker `rows` go through `addRow`; repeated `equipment-photos` entries append
independent images, while single-image attachment slots reject duplicates.

Tracker seeds preserve Continuity’s recorded wall-clock time when converting
offset-bearing timestamps to the app’s `datetime-local` fields. The restore
test verifies that every seeded reading is accepted by the chart parser.

## Verification

Use `bun run check`, `bun run check:affected`, or `bun run check:package` for
repository verification. The [verification guide](../docs/developer/verification.md)
describes build prerequisites, Turbo task evidence, command capture, and
checkout-bound reports.

## Adding a script

- Put commands in the purpose-specific group above, even when invoked directly.
- Keep helpers and their tests beside their owning commands; reserve `lib/` for
  helpers shared across groups. Native platform scripts stay with their package,
  and Terraform scripts stay in the infrastructure tree.
- Keep domain-specific helpers and tests beside their tooling in `checks/`,
  `architecture/`, or `protocol/`; put test launchers in `testing/`.
- Wire automated commands through the root `package.json`. When moving a file,
  update its imports, shell source paths, test fixtures, documentation, and Turbo
  inputs together.

Windows desktop releases use `./scripts/release/windowsRelease.sh build staging`
or
`build production` to dispatch GitHub Actions. After the run completes, use
`download <tier> <run-id>` to retrieve its package or `upload <tier> <run-id>`
to publish it to R2 with local credentials. See the
[Windows release guide](../packages/app-electrobun/README.md#windows-releases-from-github-actions).
