# @tearleads/validators

The Zod schemas and operation contracts for everything that crosses the API
boundary: request and response bodies, realtime frames, and the HTTP
operations that pair them with a method and path. The API, the
[typed API client](../api-client/README.md), and the
[client SDK](../client-sdk/README.md) all validate against these definitions,
so a wire shape is declared once. It is a leaf package: it depends only on
Zod.

## Entry points

| Entry point | Use for |
| --- | --- |
| `@tearleads/validators/operation` | HTTP operation contracts (method, path, request, response, summary) and the OpenAPI renderer |
| `@tearleads/validators/request` | Request body schemas and type guards |
| `@tearleads/validators/response` | Response body schemas and type guards |
| `@tearleads/validators/realtime` | Server-events WebSocket frames and client declarations |
| `@tearleads/validators/event` | The user event guard |
| `@tearleads/validators/util` | Shared wire primitives: UUIDs, hashes, base64, limits, and history wire formats |
| `@tearleads/validators/billing` | Billing error codes and native subscription store schemas |
| `@tearleads/validators/containerSystemSlot` | Format and validate container system slot names |
| `@tearleads/validators/isPlainObject` | The plain-object guard |

## OpenAPI

[`docs/openapi.json`](../../docs/openapi.json) and
[`src/operation/generatedOpenApi.ts`](src/operation/generatedOpenApi.ts) are
generated from the operation registry; never edit them by hand. Each operation
needs a `summary` and each named schema a description. After changing a contract:

```sh
bun run generate:openapi    # rewrite both artifacts
bun run lint:openapi        # fail if they are stale
bun run lint:openapi:compatibility
```

The compatibility check compares the contract with `origin/main` (or
`OPENAPI_BASE_REF`) using the pinned oasdiff; see the
[API architecture](../../docs/api-architecture.md#http-protocol-surface) for
the routes the contracts describe.

## Tests

```sh
bun run --cwd packages/validators test
```
