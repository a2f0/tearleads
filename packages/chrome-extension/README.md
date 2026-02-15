# @tearleads/chrome-extension

Chrome extension for Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Development

```bash
# Build
pnpm --filter @tearleads/chrome-extension build

# Development mode
pnpm --filter @tearleads/chrome-extension dev

# Test
pnpm --filter @tearleads/chrome-extension test

# Test with coverage
pnpm --filter @tearleads/chrome-extension test:coverage
```

## Loading the Extension

1. Build the extension: `pnpm --filter @tearleads/chrome-extension build`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` folder
