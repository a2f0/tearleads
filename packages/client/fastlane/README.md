fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

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

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
