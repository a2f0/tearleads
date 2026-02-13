# @tearleads/tee-api

Secure response proof primitives and a reference API server for TEE deployments.

## Security Model

Each response is wrapped in an envelope:

- `data`: JSON response payload
- `proof`: signed metadata binding request + response

The proof includes:

- request nonce and request digest
- response digest and status binding
- issue/expiry timestamps
- transport mode (`tls` or `loopback`)
- optional attestation hash metadata

## Build

```bash
pnpm --filter @tearleads/tee-api build
pnpm --filter @tearleads/tee-api buildBundle
```

The bundled runtime artifact is `dist/server.cjs`.
