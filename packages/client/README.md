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

### Debug Handle Inspection

Set `PW_DEBUG_HANDLES=true` to dump open handles after tests complete:

```bash
PW_DEBUG_HANDLES=true pnpm test:e2e
```

### Force Cleanup (Prevent Hang)

The script `./scripts/runPlaywrightTests.sh` enables `PW_FORCE_CLEANUP=true` by default to prevent the process from hanging after tests complete. This force-closes any open handles (sockets, child processes) that would otherwise keep Node.js alive.

To disable (e.g., for debugging):

```bash
PW_FORCE_CLEANUP=false ./scripts/runPlaywrightTests.sh
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
