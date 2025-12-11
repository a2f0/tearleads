fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios build_debug

```sh
[bundle exec] fastlane ios build_debug
```

Build debug iOS app

### ios build_release

```sh
[bundle exec] fastlane ios build_release
```

Build release iOS app

### ios test

```sh
[bundle exec] fastlane ios test
```

Run iOS tests

### ios setup_ci_environment

```sh
[bundle exec] fastlane ios setup_ci_environment
```

Setup CI environment

### ios deploy_testflight

```sh
[bundle exec] fastlane ios deploy_testflight
```

Deploy to TestFlight

### ios promote_to_production

```sh
[bundle exec] fastlane ios promote_to_production
```

Promote TestFlight build to App Store

### ios sync_certs

```sh
[bundle exec] fastlane ios sync_certs
```

Sync certificates and provisioning profiles

### ios add_device

```sh
[bundle exec] fastlane ios add_device
```

Register new device

### ios bump_build

```sh
[bundle exec] fastlane ios bump_build
```

Increment build number

### ios bump_build_if_needed

```sh
[bundle exec] fastlane ios bump_build_if_needed
```

Increment build number only if current build exists in TestFlight

### ios bump_version

```sh
[bundle exec] fastlane ios bump_version
```

Increment version number

### ios clean

```sh
[bundle exec] fastlane ios clean
```

Clean build artifacts

### ios test_maestro

```sh
[bundle exec] fastlane ios test_maestro
```

Run Maestro UI tests on iOS simulator

----


## Android

### android build_debug

```sh
[bundle exec] fastlane android build_debug
```

Build debug APK

### android build_release

```sh
[bundle exec] fastlane android build_release
```

Build release APK

### android build_aab

```sh
[bundle exec] fastlane android build_aab
```

Build release AAB for Play Store

### android deploy_internal

```sh
[bundle exec] fastlane android deploy_internal
```

Build and deploy to Play Store internal track

### android promote_to_beta

```sh
[bundle exec] fastlane android promote_to_beta
```

Promote internal to beta

### android promote_to_production

```sh
[bundle exec] fastlane android promote_to_production
```

Promote beta to production

### android test

```sh
[bundle exec] fastlane android test
```

Run Android unit tests

### android test_instrumented

```sh
[bundle exec] fastlane android test_instrumented
```

Run Android instrumented tests (requires device/emulator)

### android clean

```sh
[bundle exec] fastlane android clean
```

Clean build artifacts

### android test_maestro

```sh
[bundle exec] fastlane android test_maestro
```

Run Maestro UI tests on Android emulator

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
