# Container KEKs

This folder verifies container KEK state and derives the content-key targets a
container KEK protects; [`../index.ts`](../index.ts) exports its public
functions.

- [`containerKek.ts`](containerKek.ts) verifies container KEK state and hashes
  container key epochs, checking each epoch against its manifest and parent
  with [`containerKekEpochBinding.ts`](containerKekEpochBinding.ts) and
  [`containerKekParent.ts`](containerKekParent.ts).
- [`containerKekWrapping.ts`](containerKekWrapping.ts) derives the wrapping
  public key a child KEK is wrapped to and unwraps a parent wrap;
  [`containerKekMaterial.ts`](containerKekMaterial.ts) computes the public
  commitment and material id of a KEK.
- [`containerKekPredecessor.ts`](containerKekPredecessor.ts) wraps a
  predecessor KEK to its successor, and
  [`containerKekKeyring.ts`](containerKekKeyring.ts) seals the KEK history
  keyring under the current KEK.
- [`recipientTargets.ts`](recipientTargets.ts) derives and hashes the recipient
  targets a container KEK must be wrapped to, normalizing user recipient keys
  with [`containerUserRecipientKey.ts`](containerUserRecipientKey.ts).
- [`documentKeyTargets.ts`](documentKeyTargets.ts) derives and hashes document
  content-key target sets from verified container KEK and document link
  projections.
- [`blobKeyTargets.ts`](blobKeyTargets.ts) derives and hashes blob content-key
  target sets from verified attachment bindings and their documents' targets.
- [`blobAccessManifest.ts`](blobAccessManifest.ts) normalizes and hashes the
  blob access manifest.
- [`containerKekTypes.ts`](containerKekTypes.ts) and
  [`contentKeyTargetTypes.ts`](contentKeyTargetTypes.ts) hold the shared types.

Keep canonical hashing domains and exported helper names stable; callers import
from `@tearleads/crypto` rather than these internal files.
