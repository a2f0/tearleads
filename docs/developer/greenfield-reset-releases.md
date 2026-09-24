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
assets and authenticated read access to the Match repository, Apple API
credentials, Google Play service account and track access,
Sentry source-map upload credentials, and both selected download buckets. Match
preflight must use the configured release authentication, including
`MATCH_GIT_BASIC_AUTHORIZATION` from the release environment when set;
an unauthenticated `git ls-remote`
is not an equivalent probe. Keep authorization out of logs and command arguments.

If Bundler resolves a different Ruby from `mise which ruby`, prepend the
directories returned by `mise which ruby` and `mise which bun` to this run's
`PATH`, then verify the actual versions again. Do not hardcode versions from a
previous run or change global tooling to work around a per-process mismatch.

Freeze one clean merged source SHA for the run. The root desktop upload scripts
refuse staged, unstaged, or untracked source changes; preserve their checks.
Do not fast-forward or switch the checkout mid-release. A source repair after
publication needs its own reviewed commit and an explicit record of which
targets must be rebuilt to restore a common revision.

## Required matrix

Run macOS, Linux, and mobile wrappers from the repository root without a
positional tier argument; they build fresh artifacts before uploading. Windows
uses the separate Actions build and local publication workflow below.

| Target | Staging script | Production script | Current destination |
| --- | --- | --- | --- |
| macOS ARM64 | `scripts/uploadMacosStagingRelease.sh` | `scripts/uploadMacosRelease.sh` | Signed/notarized DMG and update archive in tier's S3 download bucket |
| Linux x64 | `scripts/uploadLinuxStagingRelease.sh` | `scripts/uploadLinuxRelease.sh` | Tested installer and update archive in tier's S3 download bucket |
| Windows x64 | `scripts/windowsRelease.sh upload staging RUN_ID` | `scripts/windowsRelease.sh upload production RUN_ID` | Verified Actions ZIP and update archive in tier's S3 download bucket |
| iOS | `scripts/uploadIosStagingRelease.sh` | `scripts/uploadIosRelease.sh` | TestFlight internal |
| Android | `scripts/uploadAndroidStagingRelease.sh` | `scripts/uploadAndroidRelease.sh` | Google Play internal |

Verify the current store lane settings before upload and report their actual
destinations. “Production app” describes the app identity; it does not request
a public store rollout. If a new supported target has acquired a release wrapper,
include it or report the scope decision. The current desktop targets are
macOS ARM64, Linux x64, and Windows x64.

`scripts/deployEverything.sh` deploys both environments and uploads both mobile
tiers, but omits desktop uploads. `scripts/uploadAllReleases.sh` currently
uploads only production mobile builds and redeploys web artifacts for both tiers.
Neither script alone completes this matrix. Prefer individual tier deployments
before store uploads so both environments regain service sooner.

## Windows build and publication

Dispatch `electrobun-windows.yml` at a pushed ref resolving to the frozen SHA,
with `tier=staging`, `production`, or `both`. Record the run ID and verify its
`headSha` before publication. The workflow runs CEF persistence and installer
checks; successful builds alone do not publish a release.
Dispatch once the source is frozen, before downtime where practical, so the
remote build can run alongside infrastructure work.

After the run succeeds, use `scripts/windowsRelease.sh download <tier> RUN_ID`
and `upload <tier> RUN_ID` from the clean frozen checkout. These helpers verify
the workflow, tier, source revision, and payload checksums; upload also publishes
source maps. Artifacts live under
`packages/app-electrobun/build/win-x64/<tier>/<commit>/`. Read the current
[Windows release instructions](../../packages/app-electrobun/README.md#windows-releases-from-github-actions)
for artifact retention and installer signing status.

If a job fails, inspect its logs before retrying. A transient runner failure can
be retried with `gh run rerun RUN_ID --failed`; retain successful jobs from the
same revision and require the resulting run to succeed. A reproducible source
failure requires a reviewed repair and a recorded release revision change.

## Scheduling and resumability

- Serialize native host builds. macOS signing and mobile builds share host build
  context; native archives can temporarily change tracked project files and
  restore them on exit. Never restore or edit those files under a running build.
- Linux builds use isolated Docker output and can overlap macOS builds after
  confirming output separation. Linux uploads and Windows downloads/uploads
  require the frozen clean checkout. Finish desktop publication before mobile
  builds; allow a host archive to finish before retrying a checkout-cleanliness
  failure. Remote Windows builds can overlap host builds. Keep unrelated Docker
  containers and mounted user applications untouched.
- Keep separate logs, exit statuses, source SHA, and artifact/build identities
  for every matrix cell. `tee` requires `pipefail` or explicit child-status
  capture. Skip a completed cell only after reading back the same publication.
- Serialize Google Play uploads and track readback for the same app. The Play
  client reads tracks through an edit transaction; opening another edit during
  upload can invalidate the publisher's edit. Wait for the upload to exit before
  querying tracks, including in independent store-verification helpers.
- Mobile root wrappers replace any supplied `IOS_RELEASE_BUILD_NUMBER_FILE` or
  `ANDROID_RELEASE_BUILD_NUMBER_FILE`. Capture the final `Build number: <n>`
  output; do not depend on passing a filename through them. If number capture
  fails after a successful upload, recover from the log/store instead of
  uploading again. Query current store state for the next valid build number.
- Capture each built desktop installer's SHA-256 immediately after its upload
  succeeds, before another tier can reuse a host output directory. Linux output
  lives under `packages/app-electrobun/build/linux-x64/<tier>/`; macOS artifacts
  use `packages/app-electrobun/build/artifacts/`. Derive filenames from the
  current packaging config and logs. Windows uses the per-commit directory in
  the Windows section above.

## macOS key access and notarization

An `errSecInternalComponent` failure may mean this tool session cannot use the
signing key even when it is unlocked. Inspect the signing failure; the OS log
may report `CSSMERR_CSP_NO_USER_INTERACTION`. First repeat a minimal signing and
verification probe on a private disposable binary in the owner's Terminal. If
that works, run the release there without changing keychain permissions. The
existing
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
   for `macos-arm64`, `linux-x64`, and `win-x64`. Resolve public bucket endpoints
   from the release scripts; currently they are
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
6. After all three desktop releases for a tier, run
   `scripts/deployStagingWebsite.sh` or `scripts/deployProductionWebsite.sh`.
   Website download links are resolved at build time and may silently use an old
   offline fallback if discovery fails. Parse the served HTML and require the
   exact current installer and checksum links for all three desktop platforms.

## Environment and fresh-client checks

Derive public API, app, demo, and website URLs from deployment configuration,
including additional configured demo domains. Verify HTTP success and expected
content for each selected tier. Use the repository's normal HTTP tooling. If
one client receives a CDN rejection, compare with another client and inspect
the response before treating it as an origin outage; do not change protection
rules merely to satisfy a probe. Recreated DNS can remain negatively cached by
local resolvers. Compare authoritative/public DNS with the system resolver; a
scoped `curl --resolve` or browser host-resolver rule can verify the new endpoint
while retaining hostname and TLS checks. Record that workaround and repeat the
normal-resolver check after caches recover; do not alter unrelated DNS settings.

With isolated fresh profiles and disposable identities in the reset's authorized
test scope, verify registration/login, creation of a container and document,
encrypted blob upload/download, synchronization to a second fresh client, and
persistence after reopening. Use the current public app/SDK flows; do not insert
rows directly or weaken signed-artifact validation. Clean up only the test data
created by this run through supported deletion, and report any residue. If live
account creation is outside the selected scope, report that functional check as
not performed; HTTP checks alone are not an end-to-end sync test.

The current fresh web profile registers automatically. For recovery into the
second profile, wait for the explicit recovery-complete state before navigating
away. Wait for the note and blob to arrive before downloading. For cleanup, move
the test folder to Trash and use Delete Forever; wait for purge completion before
closing its progress dialog. Account identities and system metadata may remain
when the app has no account-deletion flow. Purged blobs also remain until the
normal GC grace period expires; report both residues without shortening retention
or deleting objects directly.

Verify old server sessions are refused where a safely held test token permits,
and that production and staging point to different databases/blob buckets and
the correct telemetry environments. Verify service-worker refresh for the web
app. Check configured maintenance timers and alerts after provisioning.

Finish the infrastructure runbook's protection/cleanup checks. Report the exact
release revision, completed matrix, mobile channels/build numbers, download and
website verification, functional-check coverage, and remaining external-state
decisions. Do not infer public store rollout from successful uploads.
