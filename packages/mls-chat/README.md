# @tearleads/mls-chat

MLS (RFC 9420) end-to-end encrypted chat for Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { MLSGroup, useMLSChat, encryptMessage, decryptMessage } from '@tearleads/mls-chat';
```

## Development

```bash
# Build
pnpm --filter @tearleads/mls-chat build

# Test
pnpm --filter @tearleads/mls-chat test

# Test with coverage
pnpm --filter @tearleads/mls-chat test:coverage
```
