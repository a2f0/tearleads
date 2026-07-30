# App Capacitor

## Test a native subscription

The Capacitor shell already presents the RevenueCat-managed store flow from
Organization Manager → Billing. For the fastest first pass, use the project's
RevenueCat Test Store key as a one-off override; do not replace the platform
keys in `.secrets/root.env`:

```sh
VITE_REVENUECAT_IOS_API_KEY=test_... ./scripts/runIos.sh
VITE_REVENUECAT_ANDROID_API_KEY=test_... ./scripts/runAndroid.sh
```

The current RevenueCat offering contains the Test Store `sync_monthly` product,
so this path can exercise package loading, the purchase sheet, entitlement
activation, cancellation, and restore without App Store Connect or Play Console
setup. The Test Store key must never be used for an App Store, TestFlight, or
Google Play release.

To test the server-side billing activation too, point the build at staging and
enable `REVENUECAT_ALLOW_SANDBOX_EVENTS=true` on the staging API before its
Ansible deploy. Production intentionally ignores sandbox grants. Full setup and
the real Apple/Google sandbox checklist are in
[`revenuecat-native-stores.md`](../../docs/developer/revenuecat-native-stores.md).

## Production and staging store apps

Native store releases have two targets backed by shared shell and Fastlane
configuration:

| Tier | iOS bundle ID / Android application ID | Android variant | iOS scheme / configuration |
| --- | --- | --- | --- |
| Production | `com.tearleads.app` | `release` | `App` / `Release` |
| Staging | `com.tearleads.app.staging` | `staging` | `App-Staging` / `Release-Staging` |

Build or upload staging releases with:

```sh
./scripts/buildAndroidStagingRelease.sh
./scripts/buildIosStagingRelease.sh
./scripts/uploadAndroidStagingRelease.sh
./scripts/uploadIosStagingRelease.sh
```

The staging wrappers default to `https://api.tearleads.de`; production wrappers
continue to default to `https://api.tearleads.com`. All wrappers delegate to
`scripts/nativeRelease.sh`, while
`fastlane/native_release_target.rb` owns the app identifier, Gradle variant,
Xcode scheme, and Xcode configuration mapping.

Before the first staging upload, put the `goog_...` and `appl_...` public SDK
keys for the RevenueCat apps configured with `com.tearleads.app.staging` in
`.secrets/staging.env` as `VITE_REVENUECAT_ANDROID_API_KEY` and
`VITE_REVENUECAT_IOS_API_KEY`. A staging release deliberately does not inherit
the production mobile SDK keys from `.secrets/root.env`, and rejects an exported
key that matches either production key. The staging env may also override
`VITE_REVENUECAT_SYNC_ENTITLEMENT`; unrelated deploy secrets never enter the
native build process. If another root `VITE_*` setting must be shared with
staging later, add it intentionally to `NATIVE_SHARED_VITE_ENV_NAMES`. The
production platform keys must remain present in `.secrets/root.env` so staging
can prove it is not reusing them. The Google Play service account must have
access to the staging Play app, and the match repository must contain an App
Store distribution profile for the staging bundle ID. Verify the latter with:

```sh
bun run --cwd packages/app-capacitor ios:fetch:appstore-profile:staging
```

## Android Sideload

Install repo-managed tools and Ruby gems once:

```sh
mise install
cd packages/app-capacitor
bundle install
```

Build and install the debug APK on a connected Android device:

```sh
bun run android:sideload:debug
```

Set `ANDROID_SERIAL` when more than one device or emulator is attached:

```sh
ANDROID_SERIAL=<device-id> bun run android:sideload:debug
```

The release APK lane runs a release Capacitor sync before building, which clears
any live-reload URL from the generated native config:

```sh
bun run android:sideload:release
```

Release builds use `.secrets/tearleads-release.keystore` with `ANDROID_KEYSTORE_STORE_PASS` and `ANDROID_KEYSTORE_KEY_PASS` when present. Without those values, Gradle signs the release APK with the debug signing config so it can still be sideloaded locally.

## Android Google Play Release

Build a signed Android App Bundle for Google Play:

```sh
bun run android:build:google-play
```

The lane loads `.secrets/root.env`, requires `.secrets/tearleads-release.keystore`
and `ANDROID_KEYSTORE_STORE_PASS`/`ANDROID_KEYSTORE_KEY_PASS`, runs a release
Capacitor sync, and builds `android/app/build/outputs/bundle/release/app-release.aab`.
It also prints any generated upload companion assets, such as
`android/app/build/outputs/mapping/release/mapping.txt` and
`android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`.

By default, the `versionCode` is based on the latest PR merged today. The lane
queries GitHub with `gh` first and falls back to local squash-merge commit
subjects like `(#1365)`. If `.secrets/google-play-service-account.json` is
available, it also checks the configured Google Play tracks and uses the larger
of the merged PR number or the next Play version code. Override the date or PR
with `ANDROID_RELEASE_MERGED_DATE=YYYY-MM-DD`,
`ANDROID_RELEASE_PR_NUMBER=<number>`, or Fastlane options
`merged_date:YYYY-MM-DD` and `merged_pr_number:<number>`. Override the final
build number with `ANDROID_BUILD_NUMBER=<number>` or
`ANDROID_VERSION_CODE=<number>`.
Build strictly one version code higher than Google Play with
`ANDROID_RELEASE_NEXT_GOOGLE_PLAY=true` or `next_google_play:true`.

Upload the signed bundle to Google Play:

```sh
bun run android:upload:google-play
```

The upload lane builds the signed AAB first, then uploads the AAB and any
generated mapping/native-symbol files. It skips Play metadata, changelogs,
images, and screenshots. The default upload track is `internal`; override it
with `GOOGLE_PLAY_TRACK=<track>` or `google_track:<track>`. Override the release
status with `GOOGLE_PLAY_RELEASE_STATUS=<status>` or `release_status:<status>`.
Validate without committing the Play edit with `GOOGLE_PLAY_VALIDATE_ONLY=true`
or `validate_only:true`.

## iOS TestFlight Release

Build a signed iOS IPA for TestFlight:

```sh
bun run ios:build:testflight
```

The lane loads `.secrets/root.env`, runs a release Capacitor sync, verifies that
the generated native config is fully bundled, and builds
`ios/App/output/Tearleads.ipa`. Release signing requires a Developer Team ID via
`IOS_TEAM_ID`, `APPLE_TEAM_ID`, `DEVELOPMENT_TEAM`, `FASTLANE_TEAM_ID`, or the
Fastlane option `team_id:<id>`. With automatic signing, the lane passes
`-allowProvisioningUpdates` by default; disable it with
`IOS_ALLOW_PROVISIONING_UPDATES=false` or `allow_provisioning_updates:false`.

By default, the iOS build number uses the same PR-number convention as Android:
the latest PR merged today, discovered with `gh` first and local git history as
a fallback. If App Store Connect credentials are available, it also checks the
latest TestFlight build for the target app version and uses the larger of the
merged PR number or the next TestFlight build number. Configure App Store
Connect with `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and
`.secrets/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8`, or set
`APP_STORE_CONNECT_API_KEY_KEY_FILEPATH` / `APP_STORE_CONNECT_KEY_FILEPATH`.
Override the date or PR with `IOS_RELEASE_MERGED_DATE=YYYY-MM-DD`,
`IOS_RELEASE_PR_NUMBER=<number>`, or Fastlane options
`merged_date:YYYY-MM-DD` and `merged_pr_number:<number>`. Override the final
build number with `IOS_BUILD_NUMBER=<number>` or `APPLE_BUILD_NUMBER=<number>`.
Build strictly one number higher than TestFlight with
`IOS_RELEASE_NEXT_TESTFLIGHT=true` or `next_testflight:true`.

The app version comes from the Xcode target's `MARKETING_VERSION` by default.
Override it with `IOS_VERSION=<version>`, `APP_STORE_VERSION=<version>`, or the
Fastlane option `version:<version>`.

Build and upload the signed IPA to TestFlight:

```sh
bun run ios:upload:testflight
```

The upload lane builds the signed IPA first, then uploads it with the App Store
Connect API key. It uploads only by default: `TESTFLIGHT_SKIP_SUBMISSION=true`
and `TESTFLIGHT_SKIP_WAITING_FOR_BUILD_PROCESSING=true`. Override either with
the matching env var or Fastlane option. Set `TESTFLIGHT_CHANGELOG=<text>` or
`changelog:<text>` to provide "What to Test". External distribution is off by
default; enable it with `TESTFLIGHT_DISTRIBUTE_EXTERNAL=true` and provide
comma-separated `TESTFLIGHT_GROUPS`. External distribution defaults to
submission enabled unless `TESTFLIGHT_SKIP_SUBMISSION=true` is set explicitly.

## Store Build Numbers

Fetch the latest remote build numbers from Google Play and the Apple App Store:

```sh
bun run store:build-numbers
```

The lane loads `.secrets/root.env` when present, uses
`.secrets/google-play-service-account.json` by default for Google Play, and uses
`.secrets/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8` by default for App Store
Connect. Missing credentials or one store API failure do not block the other
store lookup.

It queries the standard Play tracks (`production`, `beta`, `alpha`, and
`internal`) and returns the highest version code. Override the queried Play
tracks with `GOOGLE_PLAY_TRACKS=internal,beta`, `google_tracks:internal,beta`,
`GOOGLE_PLAY_TRACK=internal`, or `google_track:internal`. Query Apple
TestFlight/edit state with `APP_STORE_LIVE=false` or `apple_live:false`. Skip a
store with `SKIP_GOOGLE_PLAY=true`, `skip_google:true`, `SKIP_APP_STORE=true`,
or `skip_apple:true`.
