# Protocol Specification

This document specifies messages, proofs, encrypted payload boundaries, and
validation rules across `@tearleads/client-sdk`,
[`packages/api`](../packages/api/), and shared `@tearleads/*` packages for
identity, access, [document](./glossary/content.md#document) sync,
[blob staging](./glossary/content.md#blob-stage),
[attachment binding](./glossary/content.md#attachment-binding), and
[slots](./glossary/content.md#attachment-slot).

The executable contract is layered:

- [`packages/validators/src/request`](../packages/validators/src/request/),
  [`packages/validators/src/response`](../packages/validators/src/response/),
  and
  [`packages/validators/src/operation`](../packages/validators/src/operation/)
  define wire grammar and HTTP metadata.
- [`packages/crypto/src/keying.ts`](../packages/crypto/src/keying.ts) defines
  canonical cryptographic checks.
- [`packages/api/src/workflows`](../packages/api/src/workflows/) defines
  authorized transactional transitions.
- [`packages/client-sdk/src/workflows`](../packages/client-sdk/src/workflows/)
  defines local decisions and [fail-closed](./glossary/access.md#fail-closed) response
  verification.

For document sync, `DocumentSyncRequestSchema` and `DocumentSyncResponseSchema`
are normative wire grammar and derive TS types; request and response predicates
delegate to them. `documentSyncOperation` owns method, auth, parameters,
statuses, and the canonical path. Parsing never coerces, defaults, strips, or
replaces signed input.

Auth challenge and verification use the same contract path:
`ChallengeRequestSchema`, `VerifyRequestSchema`, and their response schemas are
the runtime wire grammar, while `challengeOperation` and `verifyOperation` own
their HTTP metadata. API client and SDK predicates validate against these
schemas.

[`openapi.json`](./openapi.json) (exported schemas as components; operations
and schemas carry plain-language descriptions) and generated TypeScript are
structural registry views. Zod is the runtime
authority; each `x-tearleads-runtime-refinements` gap needs an executable
OpenAPI-accepts/Zod-rejects witness. Crypto, transactions, convergence, and
formal guarantees lie outside these views.

Related documents:

- [glossary.md](./glossary.md)
- [api-architecture.md](./api-architecture.md)
- [access-plane.md](./access-plane.md)
- [client-sync-ordering.md](./client-sync-ordering.md)
- [keying-design.md](./keying-design.md)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
- [security-guarantees.md](./security-guarantees.md)
- [formal protocol models](../formal/README.md)

## Contents

- [Foundations](./protocol-specification/foundations.md)
  - [Goals](./protocol-specification/foundations.md#goals)
  - [Protocol Planes](./protocol-specification/foundations.md#protocol-planes)
  - [Common Cryptographic Objects](./protocol-specification/foundations.md#common-cryptographic-objects)
- [Identity and policy](./protocol-specification/identity-and-policy.md)
  - [Identity And Session Handshake](./protocol-specification/identity-and-policy.md#identity-and-session-handshake)
  - [Principal Policy Protocol](./protocol-specification/identity-and-policy.md#principal-policy-protocol)
- [Container access](./protocol-specification/container-access.md)
  - [Container Access And KEK Protocol](./protocol-specification/container-access.md#container-access-and-kek-protocol)
  - [Document Link And Sync Protocol](./protocol-specification/container-access.md#document-link-and-sync-protocol)
- [Blobs and attachments](./protocol-specification/blobs.md)
  - [Blob Stage Protocol](./protocol-specification/blobs.md#blob-stage-protocol)
  - [Attachment Bind, Replace, Detach, And Slots](./protocol-specification/blobs.md#attachment-bind-replace-detach-and-slots)
  - [Blob Read Protocol](./protocol-specification/blobs.md#blob-read-protocol)
- [Delete and failure](./protocol-specification/delete-and-failure.md)
  - [Delete And Purge Semantics](./protocol-specification/delete-and-failure.md#delete-and-purge-semantics)
  - [Failure Semantics](./protocol-specification/delete-and-failure.md#failure-semantics)
