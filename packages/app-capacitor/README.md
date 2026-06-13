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
