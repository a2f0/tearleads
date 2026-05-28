# Container KEK Internals

`../containerKek.ts` remains the public keying facade for container KEK
verification and exported target helpers. Files in this folder hold internal
subdomains that are shared by that facade.

- `contentKeyTargets.ts` derives and hashes document/blob content-key target
  sets from verified container KEK, document link, and attachment projections.

Keep canonical hashing domains and exported helper names stable; callers import
from `@tearleads/crypto` rather than these internal files.
