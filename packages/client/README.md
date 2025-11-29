# @rapid/client

React client application for Rapid, built with Vite and deployable to Android via Capacitor.

## Setup

- Install [Maestro](https://maestro.mobile.dev/getting-started/installing-maestro) for E2E tests.

## Development

```bash
pnpm dev
```

Starts the development server on `http://localhost:3000`.

## Building

```bash
pnpm build
```

Builds the application for production in the `dist` directory.

## Preview

```bash
pnpm preview
```

## Android

### Setup

```bash
bundle install
```

### Build and Sync

```bash
pnpm build:android
```

### Fastlane

See [fastlane/README.md](fastlane/README.md) for available lanes.
