# @tearleads/ui

Shared UI components and design system for Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { Dialog, ThemeSwitcher, Tooltip, ThemeProvider } from '@tearleads/ui';
import '@tearleads/ui/styles.css';
import '@tearleads/ui/theme.css';
```

## Package Boundaries

Keep `@tearleads/ui` focused on reusable UI code:

- React components
- UI-focused hooks/providers
- design-system styles and assets

Move non-UI shared logic (types, validators, protocol helpers, pure utilities) into `@tearleads/shared`.

## Development

```bash
# Build
pnpm --filter @tearleads/ui build

# Test
pnpm --filter @tearleads/ui test

# Test with coverage
pnpm --filter @tearleads/ui test:coverage
```
