# Container KEK Internals

`../containerKek.ts` is the public keying facade for container KEK
verification and exported target helpers. This folder holds internal modules
that the facade re-exports.

- `contentKeyTargets.ts` derives and hashes document/blob content-key target
  sets from verified container KEK, document link, and attachment projections.

Keep canonical hashing domains and exported helper names stable; callers import
from `@tearleads/crypto` rather than these internal files.
