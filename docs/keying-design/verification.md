# Keying Design: Verification

Part of the [keying design](../keying-design.md).

## Transparency And Checkpointing

Signed manifests prevent unauthorized mutation but do not alone prove
latest-state freshness. The protocol uses local monotonic checkpoints first,
with an optional transparency log for cross-client append-only proofs.

Minimum:

- clients durably [pin](../glossary/principals.md#identity-pin) each first-seen
  complete identity bundle;
- clients persist highest-seen principal policy version/hash per principal;
- clients persist highest-seen access manifest epoch/hash per object;
- clients refuse to move backwards without explicit recovery UX.

Production uses an exact durable identity pin (with provenance) plus two
checkpoints:

- `PrincipalPolicyCheckpoint`: `principalType`, `principalId`, `version`,
 `stateHash`.
- `AccessManifestCheckpoint`: `objectKind`, `organizationId`, `objectId`,
 `epoch`, `manifestHash`.

Verifier rules are fail-closed:

- lower version/epoch than the local checkpoint is rollback;
- same version/epoch with a different hash is equivocation;
- higher version/epoch is accepted only when the returned signed chain or
 predecessor proof extends the local checkpoint.

Stronger, as optional hardening:

- append identity states, principal policy heads, and object manifest heads to
 an append-only Merkle log;
- return inclusion and consistency proofs with API responses;
- let clients gossip or compare signed tree heads across devices.

The shared verifier's transparency primitives use signed tree heads plus compact
Merkle proofs. Identity state heads, principal policy heads, and access manifest
heads are encoded as domain-separated transparency leaves. Inclusion proofs bind
a leaf to a signed tree head. Consistency proofs bind a newer signed tree head
to a previous pinned tree head. A first-contact client that has no pinned tree
head, gossip peer, or witness can still be shown a self-consistent split view.

Public blockchain anchoring is optional. It can timestamp an aggregate log root
and make server equivocation harder to hide, but it does not authorize object
grants, solve first-contact identity trust, or prevent withholding. If used,
anchor only aggregate tree roots, not object ids or metadata-bearing leaves.

## Client Verification API

Verification lives in `@tearleads/crypto`, shared by the API and the client
SDK. Each entry point is async and returns
`KeyingVerificationResult<T>`: `{ ok: true, value: T }` or
`{ ok: false, error: KeyingVerificationError }`.

```text
verifyIdentityStateCheckpoint(input) -> VerifiedIdentityState;
verifyPrincipalPolicyBundle(input) -> VerifiedPrincipalPolicy;
verifyAccessManifest(input) -> VerifiedAccessManifest;
verifyContainerKekState(input) -> VerifiedContainerKekState;
deriveDocumentKekTargets(input) -> VerifiedDocumentKekTargets;
deriveBlobKekTargets(input) -> VerifiedBlobKekTargets;
verifyWriteHeader(input) -> VerifiedWriteHeader;
verifyTransparencyProof(input) -> VerifiedTransparencyProof;
verifyTransparencyInclusionProof(input) -> TransparencyTreeCheckpoint;
verifyTransparencyConsistencyProof(input) -> TransparencyTreeCheckpoint;
```

The two standalone transparency verifiers work on tree checkpoints (log id,
size, root) rather than signed heads, so a client can check that a served
head extends its persisted checkpoint without an unrelated leaf or inclusion
proof. `verifyTransparencyProof` composes them over signed heads.

These functions are deterministic and side-effect free. API routes use them
for validation, but the security guarantee comes from clients running the same
verification before encrypting or decrypting.

## Programmable Proof Obligations

Keying treats verifier functions as the executable security specification.
Each verifier returns a branded verified value, and later derivation functions
accept only those values, so unverified API JSON cannot flow into encryption
decisions by type accident.

Proof obligations:

- `VerifiedIdentityState` proves that an identity state head is not older than,
 and extends, the client's local checkpoint. It does not bind that head to an
 identity trust root; first-contact trust remains a deployment boundary.
- `VerifiedPrincipalPolicy` proves the group/org policy chain is signed,
 contiguous, projection-bound, payload-bound, and key-epoch-correct for any
 shrink transition.
- `VerifiedAccessManifest` proves the object graph transition was signed by a
 user/device authorized under the previous verified manifest.
- `VerifiedContainerKekState` proves each container KEK wrap is justified by
 the verified manifest, recipient key epoch, and parent KEK edge.
- `VerifiedDocumentKekTargets` and `VerifiedBlobKekTargets` prove the exact
 target set implied by the verified graph, not by an API-provided recipient
 list.
- `VerifiedWriteHeader` proves encrypted content metadata commits to the object
 id, manifest hash, content key epoch, target hash, ciphertext hash, and
 writer identity; that the signer had write access under the committed
 manifest state; and that the ciphertext used a unique, domain-separated
 encryption record id, nonce, or subkey for the object/content-key epoch.
- `VerifiedTransparencyProof` proves the response leaf is included in the
 signed tree head and, when a previous tree head is supplied, that the newer
 tree head extends the pinned checkpoint.

Two classes of guarantees follow:

- Impossible without key compromise or broken first-contact trust: forging a
 grant, adding a recipient target, swapping a recipient key, or authorizing a
 write target that was not signed by an authorized principal.
- Detectable under checkpoint/transparency assumptions: replaying an old valid
 state or showing split views to different clients.

Withholding data, refusing proofs, delaying publication, and returning no state
remain availability failures. Clients fail closed.

## API Attack Outcomes

| API behavior | outcome |
| --- | --- |
| Adds unauthorized object grant | Missing authorized signed access event; client refuses to encrypt. |
| Changes group/org projection rows | Signed policy projection/hash mismatch; fail closed. |
| Reuses principal key after membership shrink | Policy transition rejected by verifier. |
| Swaps recipient public key | Identity/principal key fingerprint mismatch; fail closed unless first-contact trust was never established. |
| Omits a linked container target | Derived target hash differs; write/read verification fails. |
| Drops blob targets for another active binding | Blob target derivation from signed bindings catches mismatch. |
| Replays older manifest | Local highest-seen checkpoint or transparency consistency proof rejects when client has seen newer state. |
| Shows split views | Detectable through transparency consistency/gossip/witnessing; otherwise still an availability/equivocation gap. |
| Withholds state or proofs | Availability failure; clients fail closed. |
