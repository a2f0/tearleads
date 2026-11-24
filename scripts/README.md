# Repository scripts

Commands are grouped by purpose. Root [`package.json`](../package.json) scripts
are the stable entrypoints for automated checks, builds, and publishing, such as
`bun run check:fast`, `bun run lint:architecture`, or
`bun run test:static-analysis`. Direct shell shortcuts live in the groups
below. Invoke them by path from the checkout or its parent workspace, for example
[`./scripts/dev/runApp.sh`](dev/runApp.sh),
[`./scripts/release/buildIosRelease.sh`](release/buildIosRelease.sh), or
[`./scripts/deploy/deployStaging.sh`](deploy/deployStaging.sh).

| Folder | Contents |
| --- | --- |
| [`admin/`](admin/) | Explicit operational utilities, including blob-bucket inspection and root grants. |
| [`architecture/`](architecture/) | Architecture checks and reports, dependency rules, workspace and subsystem registries. |
| [`checks/`](checks/) | Check entry points, static analysis helpers, baselines, and regression fixtures. |
| [`deploy/`](deploy/) | Tier and website deployments, teardown, and their shared helpers. |
| [`dev/`](dev/) | Local launchers, shell setup, seed generation, and cache maintenance. |
| [`git/`](git/) | Hook installation and hook sources; the pre-push hook is agent-tool's push gate. |
| [`keychain/`](keychain/) | Manual macOS keychain utilities. |
| [`lib/`](lib/) | Helpers shared across script groups, including timings, build metadata, release environment guards, and the retried CI dependency install. |
| [`localstack/`](localstack/) | Local S3 setup, shutdown, and reset commands. |
| [`postgres/`](postgres/) | Development database setup, migration, and reset commands. |
| [`protocol/`](protocol/) | Formal protocol checks, trace generation and projection, negative controls, and their tests. |
| [`release/`](release/) | Native and desktop release builds/uploads, npm publishing, and their helpers and tests. |
| [`testing/`](testing/) | Test runners, screenshots, device-test launchers, and verification evidence. |

From a matrix workspace, prefix a checkout shortcut with its path, such as
`./checkouts/tearleads/scripts/deploy/deployProductionWebsite.sh`.
Scripts find repository files from their installed location. Check and
verification tools that support fixture trees take `--check-root <directory>`
as their first arguments. Git hooks use the checkout supplied by Git.

## Scope evaluations

For repository discoverability probes with Claude Code and a Codex Judge, see
the [Scope setup guide](../docs/developer/scope.md). Reusable tooling and benchmark
definitions live in [`scripts/dev/scope/`](dev/scope/); local state and artifacts
stay in the ignored `.scope/` directory. `bun run scope install`, `start`, and
`portal` manage the local stack. `bun run scope:register` uploads committed
source; `calibrate`
checks the Judge and `benchmark` runs the three inspection tasks.

## Deployment and release shortcuts

[`deploy/softReset/softReset.ts`](deploy/softReset/softReset.ts) is the
web-only application reset: `bun run soft-reset` prints a harmless preview, and
`bun run soft-reset --help` shows the explicit tier/confirmation syntax. An
authorized apply recreates only the application PostgreSQL and blob R2 stacks,
then deploys API, app/demo, and website. No mobile or desktop releases run.
Read the
[soft-reset runbook](../docs/developer/greenfield-reset.md#web-only-soft-reset-command)
for prerequisites, private timing records, the retained failure lock, and manual
recovery. Its code and fixture tests live together in
[`deploy/softReset/`](deploy/softReset/); `bun run test:soft-reset` runs those
isolated provider fixtures and is also part of `check:fast`.

For website-only deployments, run
[`./scripts/deploy/deployStagingWebsite.sh`](deploy/deployStagingWebsite.sh) or
[`./scripts/deploy/deployProductionWebsite.sh`](deploy/deployProductionWebsite.sh).
Both use the shared helper in
[`packages/website/scripts/deployWebsite.sh`](../packages/website/scripts/deployWebsite.sh);
see the
[website deployment guide](../packages/website/README.md) for credentials and
dry-run options.

Windows desktop releases use
[`./scripts/release/windowsRelease.sh`](release/windowsRelease.sh) with
`build staging` or `build production` to dispatch GitHub Actions.
After the run completes, use
`download <tier> <run-id>` to retrieve its package or `upload <tier> <run-id>`
to publish it to R2 with local credentials. See the
[Windows release guide](../packages/app-electrobun/README.md#windows-releases-from-github-actions).

The native and desktop release shortcuts, and the Android and iOS dev
launchers, prepare a fresh clone, or a worktree beside the other clones,
before building.
[`lib/secretsStore.sh`](lib/secretsStore.sh) links a missing `.secrets` to
the shared `matrix-secrets/tearleads` folder when it exists, as
[`lib/screenshotsStore.sh`](lib/screenshotsStore.sh) does for `.screenshots`,
and [`lib/gradleWrapper.sh`](lib/gradleWrapper.sh) regenerates the
gitignored Gradle wrapper jar in a scratch build, since the Android build
cannot configure before `cap sync`. `bun run test:clone-setup` covers both and
is part of `check:fast`.

[`release/publishNpmPackage.sh`](release/publishNpmPackage.sh) publishes a
package to npm by its directory name: `windowing` or `client-sdk`.
Each package's publish workflow runs it when a
version bump merges, after `agent-tool release plan --allow-private-source`
confirms the version is new; the flag is needed because these private
workspaces build public consumer manifests. To publish by hand, run
`bun run publish:npm:dry-run <package>` to build and preview it, then
`bun run publish:npm <package>` to publish it; both also accept `--tag <tag>`
and `--otp <code>`. See the
[windowing](../packages/windowing/docs/publishing.md#publishing) and
[client SDK](../packages/client-sdk/README.md#publishing) publishing guides for
authentication, versioning, and consumer smoke checks.

## Screenshot seed and capture

`bun run screenshots` seeds the account it captures the same way a person seeds
their own. Each capture API (one for desktop, one shared by tablet and phone)
starts empty, and a Playwright setup project
([`seed.setup.ts`](../packages/app-web/screenshots/seed.setup.ts)) runs
`tearleads register` and then `tearleads seed` against it with the Continuity
identity's recovery key on stdin. The CLI verifies the pinned Continuity
manifest and seed contract before writing anything. The capture then imports
that identity into a fresh browser, signs in, and waits for the app to download
the seeded documents before capturing desktop, tablet, and phone layouts in
both themes. Household
detail captures assert decoded family/equipment photos and receipts, inventory
fields, and tracker table rows and graph points. The browser locale and time
zone are pinned so the dated readings render consistently. It writes below the
gitignored `.screenshots`, which links to the `matrix-artifacts` store shared by
every clone; in a linked clone it runs only under the pinned
`agent-tool screenshots capture --apply`, which records the capture. The
`scripts/testing/takeScreenshots.sh` wrapper first links a clone with no
`.screenshots` through `agent-tool screenshots link --apply` when the store
already exists, so CI, which has none, never gets one. It then delegates to that
capture command in a linked clone and runs the package script directly
otherwise. `packages/website/scripts/linkScreenshots.sh` does the same linking
before the website stages screenshots (its `predev`, `prebuild`, and
`screenshots` scripts), so a build or deploy from a fresh clone or worktree
publishes the shared captures instead of an empty gallery; both share
`scripts/lib/screenshotsStore.sh`, tested by `bun run test:screenshots-store`.
`bun run build:website` only stages the existing captures into the website
gallery; it never captures (see
[local website screenshots](../packages/website/README.md#local-website-screenshots)).

Add canonical facts and photographic assets in
[a2f0/continuity](https://github.com/a2f0/continuity), regenerate and ship them
there, then update the root catalog commit pin and run `bun install`. The
contract test in
[`continuitySeed.test.ts`](../packages/app/src/document-types/continuity/continuitySeed.test.ts)
checks that the pinned data yields every document, title, and image the
screenshot run asserts on, and the CLI's seed tests write it to an API and read
it back from a fresh device. Tracker `rows` go through `addRow`; repeated
`equipment-photos` entries append independent images, while single-image
attachment slots reject duplicates.

Tracker seeds preserve Continuity’s recorded wall-clock time when converting
offset-bearing timestamps to the app’s `datetime-local` fields. The contract
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
  groups such as [`architecture/`](architecture/) and [`protocol/`](protocol/).
  Reserve [`lib/`](lib/) for helpers shared across groups, and put test launchers
  in [`testing/`](testing/).
- Native platform scripts stay with their package; Terraform scripts stay in
  the infrastructure tree.
- Wire automated commands through the root [`package.json`](../package.json).
  When moving a file, update its imports, shell source paths, test fixtures,
  documentation, and Turbo inputs together.
