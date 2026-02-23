# VFS Protocol Layers

This folder is organized by protocol/runtime layer to make boundaries explicit.

## Layers

- `protocol/`: Core protocol primitives and deterministic state transforms.
- `server/`: Query/feed builders and server-side schema/consistency checks.
- `client/`: Background sync client, queueing, persistence, and client harnesses.
- `transport/`: HTTP transport implementation and parser/guardrail coverage.
- `blob/`: Blob staging/attach/object-store and isolation behavior.
- `access/`: ACL key view and access projection harnesses.

## Public API

`index.ts` is the canonical package surface for `@tearleads/vfs-sync/vfs`.
Internal files are organized for maintainability, not direct external import.
