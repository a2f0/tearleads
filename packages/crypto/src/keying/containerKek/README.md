# Container KEK Internals

`../containerKek.ts` verifies container KEK state. This folder holds the
modules it builds on and the content-key target derivations; `../index.ts`
exports their public functions.

- `recipientTargets.ts` derives and hashes the recipient targets a container
  KEK must be wrapped to.
- `documentKeyTargets.ts` derives and hashes document content-key target sets
  from verified container KEK and document link projections.
- `blobKeyTargets.ts` derives and hashes blob content-key target sets from
  verified attachment bindings and their documents' targets.
- `blobAccessManifest.ts` normalizes and hashes the blob access manifest.

Keep canonical hashing domains and exported helper names stable; callers import
from `@tearleads/crypto` rather than these internal files.
