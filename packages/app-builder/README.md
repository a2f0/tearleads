# @tearleads/app-builder

White-label app builder that enables building multiple apps with different bundle IDs, features, and branding from a single codebase.

## Overview

The app-builder package provides:

- **Multi-app configuration** - Define apps in `apps/{app-id}/config.ts` with unique bundle IDs, features, and themes
- **Feature tree-shaking** - Enable/disable features per app; disabled packages are stubbed at build time
- **Platform config generation** - Auto-generate Capacitor, iOS, and Android configuration files
- **CLI tooling** - Validate configs, list apps, inspect package dependencies

## Directory Structure

```text
packages/app-builder/
  apps/
    tearleads/          # Default app (all features)
      config.ts         # AppConfig definition
      assets/           # App-specific icons (future)
    acme-crm/           # Example white-label app
      config.ts
  src/
    types.ts            # AppConfig, AppFeature types
    schema.ts           # Zod validation schemas
    feature-map.ts      # Feature -> packages mapping
    loader.ts           # Config loading utilities
    cli.ts              # CLI commands
    generators/
      capacitor.ts      # capacitor.config.ts generator
      ios.ts            # Appfile, Matchfile, xcconfig
      android.ts        # strings.xml, app-config.gradle
      index.ts          # Export all generators
```

## Quick Start

### Generate Configuration for an App

```bash
# Generate all config files for the default app
pnpm --filter @tearleads/app-builder generate --app tearleads

# Or using tsx directly
cd packages/app-builder
tsx src/cli.ts generate --app tearleads

# Generate for a specific platform
tsx src/cli.ts generate --app tearleads --platform ios

# Dry run (preview without writing)
tsx src/cli.ts generate --app tearleads --dry-run
```

### List Available Apps

```bash
tsx src/cli.ts list
# Output:
# Available apps:
#   - tearleads
```

### Validate App Configuration

```bash
# Validate a specific app
tsx src/cli.ts validate --app tearleads

# Validate all apps
tsx src/cli.ts validate --all
```

### Inspect Package Dependencies

```bash
# Show enabled and disabled packages for an app
tsx src/cli.ts packages --app tearleads

# Show only disabled packages (for tree-shaking)
tsx src/cli.ts packages --app acme-crm --disabled --json
```

## Creating a New App

1. Create a new directory under `apps/`:

   ```bash
   mkdir -p apps/acme-crm
   ```

1. Create `apps/acme-crm/config.ts`:

```typescript
import type { AppConfig } from '../../src/types.js';

const config: AppConfig = {
  id: 'acme-crm',
  displayName: 'Acme CRM',

  bundleIds: {
    ios: 'com.acme.crm',
    android: 'com.acme.crm',
    desktop: 'com.acme.crm.desktop'
  },

  platforms: ['ios', 'android'],

  // Only include features this app needs
  features: ['contacts', 'calendar', 'email', 'notes'],

  api: {
    productionUrl: 'https://api.acme-crm.com/v1'
  },

  theme: {
    primaryColor: '#2563EB',
    backgroundColor: '#1E293B',
    accentColor: '#38BDF8'
  },

  store: {
    androidKeyAlias: 'acme-crm'
  }
};

export default config;
   ```

1. Validate and generate:

```bash
tsx src/cli.ts validate --app acme-crm
tsx src/cli.ts generate --app acme-crm
```

## AppConfig Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique kebab-case identifier (e.g., `acme-crm`) |
| `displayName` | string | Yes | Human-readable name for app stores |
| `bundleIds.ios` | string | Yes | iOS bundle identifier |
| `bundleIds.android` | string | Yes | Android application ID |
| `bundleIds.desktop` | string | Yes | Desktop/Electron app ID |
| `platforms` | array | Yes | Enabled platforms: `ios`, `android`, `desktop`, `pwa` |
| `features` | array | Yes | Enabled features (see below) |
| `api.productionUrl` | string | Yes | Production API endpoint |
| `api.stagingUrl` | string | No | Staging API endpoint |
| `theme.primaryColor` | string | Yes | Primary brand color (hex) |
| `theme.backgroundColor` | string | Yes | Background color (hex) |
| `theme.accentColor` | string | Yes | Accent color (hex) |
| `store.appleTeamId` | string | No | iOS team ID (falls back to env) |
| `store.androidKeyAlias` | string | No | Android signing key alias |
| `keychainPrefix` | string | No | SQLite keychain prefix |

## Available Features

Each feature maps to one or more workspace packages that will be included in the build:

| Feature | Package(s) | Description |
|---------|-----------|-------------|
| `admin` | `@tearleads/admin` | Admin panel |
| `analytics` | `@tearleads/analytics` | Usage analytics |
| `audio` | `@tearleads/audio` | Audio playback |
| `businesses` | `@tearleads/businesses` | Business management |
| `calendar` | `@tearleads/calendar` | Calendar/scheduling |
| `camera` | `@tearleads/camera` | Camera capture |
| `classic` | `@tearleads/classic` | Legacy compatibility |
| `compliance` | `@tearleads/compliance` | Compliance tools |
| `contacts` | `@tearleads/contacts` | Contact management |
| `email` | `@tearleads/email` | Email client |
| `health` | `@tearleads/health` | Health tracking |
| `mls-chat` | `@tearleads/mls-chat` | Encrypted messaging |
| `notes` | `@tearleads/notes` | Note taking |
| `sync` | `@tearleads/sync` | Cloud sync |
| `terminal` | `@tearleads/terminal` | Terminal/console |
| `vehicles` | `@tearleads/vehicles` | Vehicle management |
| `wallet` | `@tearleads/wallet` | Digital wallet |

### Core Packages (Always Included)

These packages are included in every app regardless of feature selection:

- `@tearleads/db` - Database layer
- `@tearleads/help` - Help system
- `@tearleads/keychain` - Secure storage
- `@tearleads/notifications` - Push notifications
- `@tearleads/search` - Search functionality
- `@tearleads/settings` - App settings
- `@tearleads/shared` - Shared utilities
- `@tearleads/ui` - UI components
- `@tearleads/vfs-explorer` - Virtual filesystem
- `@tearleads/window-manager` - Window management

## Generated Files

Running `generate` creates the following files in `packages/client/`:

| File | Platform | Description |
|------|----------|-------------|
| `capacitor.config.ts` | All | Capacitor configuration |
| `fastlane/Appfile` | iOS | Fastlane app identifiers |
| `fastlane/Matchfile` | iOS | Code signing config |
| `ios/App/App.xcconfig` | iOS | Xcode build settings |
| `android/app-config.gradle` | Android | Gradle config fragment |
| `android/app/src/main/res/values/strings.xml` | Android | App name resource |
| `generated/app-config.json` | All | Runtime app metadata |
| `generated/env.sh` | All | CI environment script |

## Feature Tree-Shaking

When a feature is disabled, its packages are aliased to empty stubs at build time using Vite. This reduces bundle size by excluding unused code.

The client's `vite.aliases.ts` reads the app config and generates aliases:

```typescript
// Disabled packages resolve to empty modules
{
  '@tearleads/vehicles': '/path/to/empty-stub.ts',
  '@tearleads/wallet': '/path/to/empty-stub.ts',
}
```

## CI Integration

The `generate` command runs in CI before building the client:

```yaml
- name: Generate app configs
  run: |
    npm install -g tsx
    cd packages/app-builder
    tsx src/cli.ts generate --app tearleads
```

This ensures `generated/app-config.json` exists for:

- TypeScript compilation (type-checks import)
- Vite builds (runtime config injection)
- Unit tests (mock data)

## Programmatic API

```typescript
import {
  loadAppConfig,
  listApps,
  getEnabledPackages,
  getDisabledPackages,
  validateAppConfig
} from '@tearleads/app-builder';

// Load and validate an app config
const { config, configDir } = await loadAppConfig('acme-crm');

// List all available apps
const apps = listApps(); // ['tearleads', 'acme-crm']

// Get packages for tree-shaking
const enabled = getEnabledPackages(config.features);
const disabled = getDisabledPackages(config.features);

// Validate config data
const result = validateAppConfig(rawConfigObject);
```

## Types

```typescript
import type {
  AppConfig,
  AppFeature,
  AppPlatform,
  AppTheme,
  AppApiConfig,
  AppBundleIds,
  AppStoreConfig,
  LoadedAppConfig
} from '@tearleads/app-builder';
```
