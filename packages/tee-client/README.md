# @tearleads/tee-client

Client for `@tearleads/tee-api` that verifies secure/private request-response guarantees.

## Assertions Per Request

- transport privacy (`https` or loopback exception)
- signature validity (trusted key pinning)
- request digest binding (nonce + request body)
- response digest binding (status + payload)
- freshness (issued/expiry window)
- cache privacy (`cache-control: no-store`)

## Usage

```ts
import { createTeeClient, createTeeApiConsumer } from '@tearleads/tee-client';

const client = createTeeClient({
  baseUrl: 'https://tee.example.com',
  trustedPublicKeys: {
    'tee-primary': process.env.TEE_PUBLIC_KEY_PEM ?? ''
  }
});

const consumer = createTeeApiConsumer(client);
const result = await consumer.echo('hello');
console.log(result.response, result.assertions.secureAndPrivate);
```
