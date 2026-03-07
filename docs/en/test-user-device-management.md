# Test User & Device Management

Fastlane lanes for managing TestFlight beta testers (iOS), Google Play tester groups (Android), and Apple Developer device registration.

## iOS: TestFlight Tester Management

Manage external TestFlight beta testers via the App Store Connect API.

### Prerequisites

- `APP_STORE_CONNECT_KEY_ID` — App Store Connect API Key ID
- `APP_STORE_CONNECT_ISSUER_ID` — App Store Connect Issuer ID
- API key `.p8` file at `.secrets/AuthKey_<KEY_ID>.p8`

### Add a tester

```bash
bundle exec fastlane ios add_tester email:user@example.com
```

With optional group assignment and name:

```bash
bundle exec fastlane ios add_tester \
  email:user@example.com \
  first_name:Jane \
  last_name:Doe \
  groups:"Beta Testers,QA Team"
```

Groups must already exist in App Store Connect. If a group name is not found, a warning is printed and the tester is still added to the remaining valid groups.

### Remove a tester

```bash
bundle exec fastlane ios remove_tester email:user@example.com
```

Removes the tester from the app only. If the tester is enrolled in other apps under the same team, those are unaffected.

### List testers

```bash
bundle exec fastlane ios list_testers
```

Displays all external beta testers for the app, including their group memberships.

## iOS: Device Registration

Register test devices in the Apple Developer Portal for development/ad-hoc provisioning.

### Register a single device

```bash
bundle exec fastlane ios add_device name:"John's iPhone 15" udid:00008030-001A3C440E30802E
```

Registers the device and regenerates development provisioning profiles.

### Bulk register devices from a file

```bash
bundle exec fastlane ios register_devices_from_file
```

Reads from `packages/client/devices.txt` by default. Override with a custom path:

```bash
bundle exec fastlane ios register_devices_from_file devices_file:/path/to/devices.txt
```

#### devices.txt format

Tab-separated, one device per line with a header row:

```text
Device ID    Device Name
00008030-001A3C440E30802E    John's iPhone 15
00008101-000A28E21E89001E    Test iPad Pro
```

After registration, development provisioning profiles are automatically regenerated via `match --force_for_new_devices`.

## Android: Google Play Tester Group Management

Manage which Google Groups have access to testing tracks on Google Play.

### Required credentials

- `GOOGLE_PLAY_JSON_KEY_FILE` — path to a Google Play service account JSON key file

### Limitation

The Google Play Developer API only supports **Google Groups** for tester management, not individual email addresses. To add individual testers, either:

1. Add them to a Google Group and use that group here, or
2. Add them manually in the [Google Play Console](https://play.google.com/console)

### Update tester groups

```bash
bundle exec fastlane android update_testers groups:"testers@googlegroups.com"
```

Multiple groups, comma-separated:

```bash
bundle exec fastlane android update_testers \
  groups:"qa-team@googlegroups.com,beta-testers@googlegroups.com" \
  track:beta
```

Default track is `internal`. Available tracks: `internal`, `alpha`, `beta`, `production`.

**Warning:** This replaces the entire tester group list for the track. To add a group, include all existing groups plus the new one.

### List tester groups

```bash
bundle exec fastlane android list_testers
```

For a specific track:

```bash
bundle exec fastlane android list_testers track:beta
```

## Lane Reference

| Platform | Lane | Description |
|----------|------|-------------|
| iOS | `add_tester` | Add external TestFlight beta tester by email |
| iOS | `remove_tester` | Remove external TestFlight beta tester by email |
| iOS | `list_testers` | List all external TestFlight beta testers |
| iOS | `add_device` | Register a single device by UDID |
| iOS | `register_devices_from_file` | Bulk register devices from a file |
| Android | `update_testers` | Set Google Group testers for a track |
| Android | `list_testers` | List Google Group testers for a track |
