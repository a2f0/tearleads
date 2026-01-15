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

## Testing

### Unit Tests

```bash
pnpm test           # Run unit tests
pnpm test:coverage  # Run with coverage report
```

### E2E Tests (Playwright)

Web E2E tests run headless by default:

```bash
pnpm test:e2e                          # Run all web E2E tests (headless)
pnpm test:e2e --headed                 # Run with visible browser
pnpm test:e2e tests/index.spec.ts      # Run specific test file
pnpm test:e2e -g "login"               # Run tests matching pattern
```

### E2E Tests (Electron)

Electron tests run headless by default:

```bash
pnpm electron:test                     # Run all Electron E2E tests (headless)
HEADED=true pnpm electron:test         # Run with visible window
```

### Handle Leak Detection

Tests automatically fail if unexpected handles remain open after completion. This detects resource leaks (unclosed sockets, timers, child processes) that would otherwise hang the test runner.

Expected handles (stdio streams) are allowed. To see verbose handle details:

```bash
PW_DEBUG_HANDLES=true pnpm test:e2e
```

## Android

### Android Setup

```bash
bundle install
```

### Build and Sync

```bash
pnpm build:android
```

### Fastlane

See [fastlane/README.md](fastlane/README.md) for available lanes.
