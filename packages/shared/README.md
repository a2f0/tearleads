# @rapid/shared

Shared TypeScript types and utilities for the Rapid monorepo.

## Installation

This package is part of the Rapid monorepo and should be referenced internally:

```json
{
  "dependencies": {
    "@rapid/shared": "*"
  }
}
```

## Usage

```typescript
import { formatDate, ApiResponse, User } from '@rapid/shared';

// Use utilities
const formatted = formatDate(new Date());

// Use types
const user: User = {
  id: '123',
  email: 'user@example.com',
  name: 'John Doe',
  createdAt: new Date(),
  updatedAt: new Date()
};

const response: ApiResponse<User> = {
  success: true,
  data: user
};
```

## Building

```bash
npm run build
```

This will compile the TypeScript files and generate type definitions in the `dist` directory.
