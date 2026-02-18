# @tearleads/api-client

Shared API consumer package for Tearleads clients.

## What it includes

- Typed API route wrappers (`api`)
- Token refresh + retry logic (`tryRefreshToken`)
- Auth storage helpers (`@tearleads/api-client/authStorage`)

## Usage

```ts
import { api, API_BASE_URL, setApiEventLogger } from '@tearleads/api-client';
import { logApiEvent } from '@/db/analytics';

setApiEventLogger(logApiEvent);

const ping = await api.ping.get();
```

```ts
import { isLoggedIn, readStoredAuth } from '@tearleads/api-client/authStorage';
```
