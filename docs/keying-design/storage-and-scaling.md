# Keying Design: Storage And Scaling

Part of the [keying design](../keying-design.md).

## Storage State

Core server tables:

- `principal_states`
- `principal_state_payloads`
- `principal_membership_projection`
- `principal_member_envelopes`
- `access_events`
- `access_manifests`
- `access_manifest_heads`
- `container_key_epochs`
- `container_key_wraps`
- `document_content_key_epochs`
- `document_content_key_targets`
- `document_content_write_headers`
- `blob_content_key_epochs`
- `blob_content_key_targets`
- `blob_content_write_headers`

Projection/cache tables include:

- `access_manifest_principal_head_projection`
- `access_manifest_document_link_projection`
- `attachment_bindings`

Identity pins and monotonic checkpoints live in client-local storage; the
server has no identity-state or transparency-log tables.

Projection tables are caches; the verifier must be able to reject a projection
that does not match signed manifests.

## Scaling Model

The design relies on not propagating access changes into every descendant
document/blob row.

Expected costs:

| Operation | Expected write cost |
| --- | --- |
| Create container | `O(1)` plus parent manifest verification and one container KEK epoch. |
| Additive share on container | `O(new recipient key wraps)`; no document/blob rewrite. |
| Revoke on container | `O(remaining direct wrap targets for that container)` plus one new container KEK epoch; descendants rekey lazily before future writes. |
| Move container | `O(1)` manifest/key update for moved container, unless policy chooses eager descendant rekey. |
| Link document to container | `O(number of linked containers for that document)`, usually small. |
| Document write | `O(number of linked containers for that document)`, not `O(users)`. |
| Blob attach/write | `O(number of active document/container target domains for that blob)`, not `O(users)`. |

For tens of thousands of folders/documents and up to roughly 1000 users, this
is viable if these constraints hold:

- Most documents are linked to a small number of containers.
- Most blobs have a small number of active bindings.
- Container KEKs inherit through parent KEK edges so ancestor additive shares do
 not require descendant key rewrites.
- Group grants target principal KEKs, not every user directly.
- The API maintains projection indexes for listing and search, but encryption
 decisions are made from verified manifests.

The scaling cliff to avoid is embedding expanded effective recipients or
descendant document references inside container manifests. A container manifest
should commit to direct grants and parent/key edges, not the full subtree or all
linked documents.

With 1000 users, direct user grants on a container are still acceptable for
small shares, but organization-wide sharing should go through the reserved
`Members` group or another group principal key. Otherwise an additive grant can
still be `O(1000)` key wraps, which is manageable occasionally but should not
be the default hot path.

The main residual cost is lazy rekey after revocation. A subtractive change on a
high-level container can force future writes in a large subtree to first
materialize post-revocation descendant KEK epochs. The levels above a directly
granted container are re-keyed with the rotation itself; everything else is
first-writer-wins lazy materialization. The security rule is that future writes
must not continue under a KEK chain reachable by the revoked principal.

## Protocol Surface

The protocol covers:

1. Canonical encodings and shared verifier APIs for Keying objects.
2. Signed access event and manifest types for containers, document link sets,
 and attachment binding events.
3. Principal-policy state storage, admin-signer checks,
 [member envelopes](../glossary/keys.md#member-envelope), and local checkpoint
 verifier primitives.
4. Container KEK epoch/wrap storage and target derivation.
5. Document create/sync with document KEK targets and signed write headers.
6. Signed document link/unlink manifests and multi-container target validation.
7. Blob attachment binding/detach with blob KEK targets and staged blob
 write headers.
8. [Rotation-baseline](../glossary/keys.md#rotation-baseline) markers and the
 attachment blob registry for signed write paths.

Deployment boundaries:

1. Verifier outputs are required before encryption and decryption decisions;
 workflows that bypass them are outside the protocol guarantee.
2. Offline structural creation depends on signed local intents until the server
 accepts authoritative manifests and KEK targets.
3. Transparency log inclusion and consistency proofs are optional hardening
 around the core signed-state protocol.
4. First-contact identity trust depends on identity links exchanged out of
 band, invitations, key transparency, or another external trust root.

## Required Invariants

- An honest client can derive document/blob key targets without trusting
 API-authored recipient lists.
- A forged object grant cannot make an honest client encrypt to a new
 recipient without an authorized signature.
- Additive share on an ancestor does not rewrite descendant document/blob
 content-key bundles.
- Subtractive change prevents future writes under KEK epochs reachable by the
 removed subject.
- Multi-linked documents require all linked container KEK targets.
- Blob writes and attachment commits cannot drop targets for other active
 signed bindings.
- A read-only recipient cannot produce a content write that passes
 `verifyWriteHeader`, even when they can decrypt the current content key.
- Concurrent/offline writers cannot reuse an AEAD key/nonce pair for two
 different content records under the same content-key epoch.
- Local child creation under a local-only parent queues without inventing a
 server access hash.
- Clients enforce exact durable identity pins and monotonic checkpoints for
 principal policies and object manifests.
- Regression coverage includes malicious API fixtures for forged grants,
 swapped keys, omitted targets, stale manifests, split projection rows, and
 key-epoch reuse after membership shrink.
