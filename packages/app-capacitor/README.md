# App Capacitor

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

The release APK lane runs a release Capacitor sync before building, which disables Capacitor HTTP in the generated native config:

```sh
bun run android:sideload:release
```

Release builds use `.secrets/tearleads-release.keystore` with `ANDROID_KEYSTORE_STORE_PASS` and `ANDROID_KEYSTORE_KEY_PASS` when present. Without those values, Gradle signs the release APK with the debug signing config so it can still be sideloaded locally.

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
