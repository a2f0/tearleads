# @tearleads/photos

Photo management components for Tearleads, providing features for photo uploads, album organization, and viewing.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

This package is primarily consumed via the `PhotosUIProvider`, which provides context to all photo-related components and hooks.

```typescript
import { PhotosUIProvider } from '@tearleads/photos';

// The PhotosUIProvider requires a set of props to function,
// including data fetching functions and UI component implementations.
// Refer to `PhotosUIProviderProps` for the full contract.
function App({ photosProviderProps }) {
  return (
    <PhotosUIProvider {...photosProviderProps}>
      {/* Components that use the photos context, like PhotosWindow, go here */}
    </PhotosUIProvider>
  );
}
```

## Development

```bash
# Build
pnpm --filter @tearleads/photos build

# Clean build artifacts
pnpm --filter @tearleads/photos clean

# Test
pnpm --filter @tearleads/photos test

# Test with coverage
pnpm --filter @tearleads/photos test:coverage
```
