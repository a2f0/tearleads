# Greenfield reset releases and verification

Release reference for the Codex and Claude `greenfield-reset` skill. Start after
the [infrastructure workflow](greenfield-reset.md) has restored selected tiers.
Preflight this work before downtime so signing or store access does not strand
the reset at release time.

## Preflight and source binding

Read [desktop packaging](../../packages/app-electrobun/README.md),
[native packaging](../../packages/app-capacitor/README.md), and the current root
wrappers. Resolve tooling from `.mise.toml` and verify the processes actually
use it: Bun, Ruby, Bundler/Fastlane, Java, Xcode, and Docker where applicable.
Check `bundle check` in the native package's documented context. Check signing
assets, Apple API credentials, Google Play service account and track access,
Sentry source-map upload credentials, and both selected download buckets.

On the September 2026 macOS host, `mise exec -- bundle ...` selected a different
Ruby from `mise which ruby`. If that recurs, prepend the directories returned
by `mise which ruby` and `mise which bun` to this run's `PATH`, then verify the
actual versions again. Do not hardcode that run's versions or change global
tooling to work around a per-process mismatch.

Freeze one clean merged source SHA for the run. The root desktop upload scripts
refuse staged, unstaged, or untracked source changes; preserve their checks.
Do not fast-forward or switch the checkout mid-release. A source repair after
publication needs its own reviewed commit and an explicit record of which
targets must be rebuilt to restore a common revision.

## Required matrix

Run each selected tier's wrappers from the repository root with no positional
tier argument. The wrappers build fresh artifacts before uploading.

| Target | Staging script | Production script | Current destination |
| --- | --- | --- | --- |
| macOS ARM64 | `scripts/uploadMacosStagingRelease.sh` | `scripts/uploadMacosRelease.sh` | Signed/notarized DMG and update archive in tier's S3 download bucket |
| Linux x64 | `scripts/uploadLinuxStagingRelease.sh` | `scripts/uploadLinuxRelease.sh` | Tested installer and update archive in tier's S3 download bucket |
| iOS | `scripts/uploadIosStagingRelease.sh` | `scripts/uploadIosRelease.sh` | TestFlight internal |
| Android | `scripts/uploadAndroidStagingRelease.sh` | `scripts/uploadAndroidRelease.sh` | Google Play internal |

Verify the current store lane settings before upload and report their actual
destinations. “Production app” describes the app identity; it does not request
a public store rollout. If a new supported target has acquired a release wrapper,
include it or report the scope decision. The current desktop wrappers publish
macOS ARM64 and Linux x64; they do not publish a Windows installer.

`scripts/deployEverything.sh` deploys both environments and uploads both mobile
tiers, but omits desktop uploads. `scripts/uploadAllReleases.sh` currently
uploads only production mobile builds and redeploys web artifacts for both tiers.
Neither script alone completes this matrix. Prefer individual tier deployments
before store uploads so both environments regain service sooner.

## Scheduling and resumability

- Serialize native host builds. macOS signing and mobile builds share host build
  context; native archives can temporarily change tracked project files and
  restore them on exit. Never restore or edit those files under a running build.
- Linux builds use isolated Docker output and can overlap macOS builds after
  confirming output separation. Before starting either Linux upload, require
  the frozen clean checkout. The simplest reliable schedule is macOS and Linux
  first, then mobile sequentially; allow a host archive to finish before retrying
  a checkout-cleanliness failure. Keep unrelated Docker containers and mounted
  user applications untouched.
- Keep separate logs, exit statuses, source SHA, and artifact/build identities
  for every matrix cell. `tee` requires `pipefail` or explicit child-status
  capture. Skip a completed cell only after reading back the same publication.
- Mobile root wrappers replace any supplied `IOS_RELEASE_BUILD_NUMBER_FILE` or
  `ANDROID_RELEASE_BUILD_NUMBER_FILE`. Capture the final `Build number: <n>`
  output; do not depend on passing a filename through them. If number capture
  fails after a successful upload, recover from the log/store instead of
  uploading again. Query current store state for the next valid build number.
- Capture each built desktop installer's SHA-256 immediately after its upload
  succeeds, before another tier can reuse a host output directory. Linux output
  lives under `packages/app-electrobun/build/linux-x64/<tier>/`; macOS artifacts
  use `packages/app-electrobun/build/artifacts/`. Derive filenames from the
  current packaging config and logs.

## macOS key access and notarization

An `errSecInternalComponent` failure may mean this tool session cannot use the
signing key even when it is unlocked. Inspect the signing failure; the OS log
may report `CSSMERR_CSP_NO_USER_INTERACTION`. The existing
`scripts/keychain/authorizeCodesignPartitionList.sh` requires the owner's
interactive Terminal. Never request or capture a keychain password in chat.

When interactive key access is needed, prepare a reviewable `.command` wrapper
in this run's private directory: change to this checkout, select pinned tools,
verify the frozen source, run the appropriate root upload script, capture its
real exit status and log, and use a lock to avoid duplicate builds. Launch it
in the user's Terminal when the current session authorizes that local action;
otherwise provide the exact prepared command and explain the observed OS
restriction. If the user is already running it, monitor that run or await its
result instead of launching another.

Notarization can remain quiet for minutes, with no desktop prompt. Poll the
existing process/log and Apple's submission status where available. Distinguish
queued processing from an explicit signing/notarization rejection. Do not kill
or retry a live submission based on silence. Verify app and DMG notarization,
stapling, and final validation, followed by successful publication. Report a
real provider failure or inaccessible signing key precisely and continue other
independent targets.

## Publication and website verification

1. Verify all selected release scripts exited zero, their source maps uploaded
   where configured, and their packaging/install/persistence checks passed.
   Success in a build phase does not establish successful publication.
2. Fetch each tier's `canary` (staging) or `stable` (production) discovery JSON
   for both `macos-arm64` and `linux-x64`. Resolve public bucket endpoints from
   the release scripts; currently they are
   `https://s3.us-east-1.amazonaws.com/<bucket>/`. The bucket names themselves
   need not have DNS records.
3. Validate each discovery document names a matching immutable installer and
   `.sha256` file. Download the actual public installer bytes and compare the
   digest with the published checksum, filename digest, and the locally
   captured **current run's build** digest. Compare before/after manifests to
   identify stale publication. An identical pre-existing digest is acceptable
   only when a successful current build proves byte-for-byte identity.
4. Re-read configured updater discovery and verify it references the new update
   archive; check archive availability and the integrity metadata its format
   defines. Installer discovery alone does not verify the automatic-update path.
5. Read back Apple processing and internal-testing availability, not just upload
   acceptance. Query Google Play's selected track and confirm its exact version
   code. Wait for processing/visibility without re-uploading while pending.
6. After both desktop releases for a tier, run
   `scripts/deployStagingWebsite.sh` or `scripts/deployProductionWebsite.sh`.
   Website download links are resolved at build time and may silently use an old
   offline fallback if discovery fails. Parse the served HTML and require the
   exact current installer and checksum links for both desktop platforms.

## Environment and fresh-client checks

Derive public API, app, demo, and website URLs from deployment configuration,
including additional configured demo domains. Verify HTTP success and expected
content for each selected tier. Use the repository's normal HTTP tooling. If
one client receives a CDN rejection, compare with another client and inspect
the response before treating it as an origin outage; do not change protection
rules merely to satisfy a probe.

With isolated fresh profiles and disposable identities in the reset's authorized
test scope, verify registration/login, creation of a container and document,
encrypted blob upload/download, synchronization to a second fresh client, and
persistence after reopening. Use the current public app/SDK flows; do not insert
rows directly or weaken signed-artifact validation. Clean up only the test data
created by this run through supported deletion, and report any residue. If live
account creation is outside the selected scope, report that functional check as
not performed; HTTP checks alone are not an end-to-end sync test.

Verify old server sessions are refused where a safely held test token permits,
and that production and staging point to different databases/blob buckets and
the correct telemetry environments. Verify service-worker refresh for the web
app. Check configured maintenance timers and alerts after provisioning.

Finish the infrastructure runbook's protection/cleanup checks. Report the exact
release revision, completed matrix, mobile channels/build numbers, download and
website verification, functional-check coverage, and remaining external-state
decisions. Do not infer public store rollout from successful uploads.
