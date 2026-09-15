# Electrobun staging diagnostics verification

The remaining live verification in [#2264](https://github.com/a2f0/tearleads/issues/2264)
passed on **2026-09-15**. The source-map upload and main-process reporting
implementation from [#2303](https://github.com/a2f0/tearleads/pull/2303) required
no further code changes.

## Release and publication

Both builds used the clean source commit
`a8010ae81f461e40b86617fb749f0ef8422bc305` and reported release
`tearleads-electrobun@a8010ae81f461e40b86617fb749f0ef8422bc305` to
`tearleads-electrobun-staging`, with environment `staging`.

The release commands completed:

```sh
scripts/uploadMacosStagingRelease.sh
scripts/uploadLinuxStagingRelease.sh
```

The macOS command completed from the owner's Terminal after this agent session
could not access the signing key. `xcrun stapler validate` accepted the resulting
DMG. The Linux command built through Docker, verified its installer and updater
archive, passed the installed application's CEF persistence test, uploaded maps,
and published the release.

The published staging download manifests referenced installers whose SHA-256
digests matched the locally built files:

| Target | Installer SHA-256 |
| --- | --- |
| macOS ARM64 | `5b1981e3d1d11afa6d4c321efe878f5f143fbaccd1603194df630db2d5a41ba2` |
| Linux x64 | `1500cb8d64016a614d6ab4193c846534e92da986803ff37d81cd7c5054b28e8f` |

Sentry stored separate four-file artifact bundles for `staging-app-macos-arm64`
and `staging-app-linux-x64`: the exact renderer and main-process scripts and
their maps. Maps remained outside the shipped application.

## Live event evidence

Each linked event has the release and environment above, the indicated dist,
and **no Sentry processing errors**. Sentry reconstructed source filenames,
line numbers, function names, and source context from the uploaded maps.

| Dist | Process | Event | Mapped application frame |
| --- | --- | --- | --- |
| `staging-app-macos-arm64` | Renderer | [a73d394b](https://tearleads.sentry.io/issues/7733502279/events/a73d394b85bc4a1dae39a9e308bf32b8/) | `src/renderer/electrobunFileSaver.ts:24` |
| `staging-app-macos-arm64` | Main | [efa6a305](https://tearleads.sentry.io/issues/7733496969/events/efa6a30515b4482898e5c11d2f9f7a86/) | `src/bun/index.ts:37` |
| `staging-app-linux-x64` | Renderer | [9e093919](https://tearleads.sentry.io/issues/7733505005/events/9e093919a5844b8c8177fb32e4ddc11b/) | `src/renderer/electrobunFileSaver.ts:24` |
| `staging-app-linux-x64` | Main | [d5d0dc7c](https://tearleads.sentry.io/issues/7733496969/events/d5d0dc7c1f9e4ecbb4d87d287af9307c/) | `src/bun/index.ts:37` |

Frame paths in the table are relative to `packages/app-electrobun`. The Linux
renderer event also maps the backup export caller in
`packages/app/src/mini-apps/backup-restore/BackupRestoreController.ts:82`.

## Probe method and privacy

The probes launched the signed macOS app and the Linux update archive's app
through their native launchers, using temporary homes and an isolated loopback
port. macOS used WKWebView; Linux used bundled CEF in Docker. Test-only Bun
preloads injected browser automation into the served HTML and observed outgoing
envelopes while preserving the original transport. The packaged JavaScript
bundles were unchanged.

In a fresh local identity, the automation opened **Backup / Restore** and
exported a backup. It replaced only the download request's filename header with
an overlong synthetic filename. The real main-process `Bun.write` failed, then
the renderer's real file saver rejected the HTTP 500. Both existing reporters
sent their own events; the probes did not fabricate stack frames or submit
events directly.

Inspection of the outgoing envelopes and processed events confirmed:

- Main events use `area=electrobun-main`, `diagnostic_source=request-error`,
  and no breadcrumbs. Renderer events use `area=app`, `diagnostic_source=log`.
- Both use `privacy=allowlist-v1`, a generic exception message, and handled
  exception mechanisms. Outgoing frames contain only `app:///` bundle paths,
  line/column positions, and the application-frame flag.
- Renderer breadcrumbs contain only approved `area`/`action` pairs, including
  `backup-restore.open`, `backup-restore.export`, and `app.error`.
- The synthetic filename, backup content, host paths, request details, and raw
  error messages are absent. The outgoing user field is only IP `0.0.0.0`.
- The project's IP-address scrubbing, data scrubbing, and default data scrubbing
  settings are enabled.

An exploratory Linux event arrived before its maps were uploaded. A subsequent
renderer event still lacked source annotations; a fresh event several minutes
later mapped correctly, as linked above. Existing events are not a verification
of a later upload: [Sentry requires a new event after uploading maps](https://docs.sentry.io/platforms/javascript/guides/hono/sourcemaps/troubleshooting_js/).

Local validation also passed all 364 desktop tests and all 10 shared diagnostics
tests. This verifies staging ingestion and symbolication; production was not
deployed or tested in this audit.
