# @tearleads/mls-core

Core MLS (RFC 9420) client and storage primitives used by Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Package Exports

| Export | Description |
| --- | --- |
| `MlsClient` | Client wrapper for credential, key package, group, and message flows |
| `MlsStorage` | Persistence layer for MLS state |
| `MLS_CIPHERSUITE_ID`, `MLS_CIPHERSUITE_NAME` | Default ciphersuite constants |
| `LocalKeyPackage`, `LocalMlsState`, `MlsCredential` | Core MLS type definitions |

## Usage

```typescript
import { MlsClient } from '@tearleads/mls-core';

const client = new MlsClient('user-123');
await client.init();
await client.generateCredential();
const keyPackage = await client.generateKeyPackage();
```

## Development

```bash
# Build
pnpm --filter @tearleads/mls-core build

# Test
pnpm --filter @tearleads/mls-core test

# Test with coverage
pnpm --filter @tearleads/mls-core test:coverage
```
