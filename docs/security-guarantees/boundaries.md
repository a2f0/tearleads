# Security Guarantees: Boundaries

Part of the [security guarantees](../security-guarantees.md).

## Boundaries

### No Universal Compromised-Server Detection

The server can withhold data, omit newer state, replay valid history, show split
views, return projections inconsistent with signed manifests, or substitute
identity keys on first contact. Validation makes many of these fail closed, but
is not global transparency unless clients pin or witness tree heads.

### Rollback And Split-View

Principal state hash chains detect inconsistent chains but do not, by
themselves, prove that the returned head is the latest.

A server that has older valid signed states can replay an older valid chain
unless the client has an independent monotonic checkpoint, highest-seen
version/hash pin, or transparency log. Production clients persist
[checkpoints](../keying-design/verification.md#transparency-and-checkpointing)
and reject rollbacks or same-version hash conflicts for principal policy and
access manifest heads. Deleted containers retain their metadata-document
reservation, and organization purge is terminal (the organization's mutations
stay refused and a replacement receives a fresh organization id), so a
checkpointed `(kind, organization, id)` is never recreated from version 1.
User identity trust uses an exact durable full-bundle pin: any later change to
either public key, fingerprint, suite, or format is rejected. Logout
and session recreation retain these pins. An intentional fresh-data environment
reset must explicitly recreate the local trust store too; an authentication
response cannot authorize clearing it.

The organization policy also commits an exact sorted directory of current group
heads. Group mutations issued by supported clients advance the group and this
directory atomically. Group share and rotation-staleness workflows verify the
organization policy and require an exact directory match, so replaying only an
old group head is detected even before that group has a local checkpoint.
Policy warming and API-supplied bundle caching also require signed directory
evidence for the requested organization, even for a self-administered group.
The directory must authenticate the full bundle head before it is pinned. A
historical manifest reference may point below that head on the verified group
chain; it need not equal the newest group state. If the cached group trails the
directory, warming fetches its newer chain. Missing or concurrently changing
scope evidence remains a cache miss. Shared create and move verification also
requires every parent-path manifest to belong to the event's organization.
Group directory ordering uses code units, independent of runtime locale.
A server that replays a self-consistent older organization policy, reserved
Admins policy, and group policy to a device with no organization checkpoint is
still exercising the cold-start rollback limit above.

### First-Contact Identity-Key Substitution

Signer lookups and other verification of users that signed state references
pin on first sight (`observed`), which cannot authenticate a stranger's keys.

Admitting a user requires an independently exchanged
[identity link](../developer/trusted-user-identity.md#identity-links) or the
device's own keys: adding a contact or roster user, adding a group member,
sharing a folder, and creating a roster profile. A link binds the service, user
ID, algorithms, and both keys. Pins record their provenance, so an `observed`
pin cannot stand in for a link; the SDK refuses group adds and user shares for
such a target, except a read-only share that the organization's signed roster
[vouches](../developer/trusted-user-identity.md#roster-vouching) for. That
vouching authenticates only the encryption key and rests on an admin whose
signing key this device verified by link or holds itself, never on an
`observed` signer; it never backs access that accepts the target's signatures.
Pin conflicts fail closed. Deliver links through an authenticated channel;
they prove no revocation, freshness, or global consistency. An unencrypted
backup can seed `link` provenance, so restoring one trusts the file's origin.

### Projection Rows Are Not A Security Boundary

Group and organization policy state is signed. Access grants are represented by
signed access events and derived access manifests in the verifier. Projection
rows such as manifest heads, principal-head projections, document-link
projections, and target caches remain indexing aids only.

If the API process is compromised, it may still return a self-consistent
projection view. Honest clients must derive encryption targets from verified
manifests and verified principal policies, not from projection rows. A client
that accepts projection rows as authority can still be tricked into encrypting
to the wrong recipient set.

### Principal Changes And Their Containers Commit Atomically

Removing a member does not erase learned keys. Group membership shrink rotates
the principal and granted containers, leaving old keys no forward bridge. The
client authors the artifacts; the API atomically rejects incomplete batches.
A client derives the required container set from the verified current and next
signed grant projections, never from the
[organization read-model](../organization-read-model-sync.md) grant lane. The API
independently compares that signed union with current verified container
manifests and requires exactly one matching mutation for every added, changed,
removed, or stale grant. A server omitting one container can therefore cause
only a failed transaction, not a falsely successful rotation. A cold client
needs only current policy and container state. Group grant revoke rotates the
group and its remaining grants; standalone group revokes are rejected, while
grant-level `read`/`write`/`admin` remains unchanged. The API also refuses every
container mutation (including revoke, move, and recite, which carry referenced
group heads forward verbatim) unless those heads equal the group's current
state. That rule is safe only because of the atomicity above: a group change
that would leave a grant stale is refused, so an honest client never holds a
container whose heads it cannot carry forward. A same-id group restarting at
version 1 is refused as a rollback; this is benign because tombstoned groups
cannot be re-granted. Organizations cannot receive container grants. Reserved
groups provide broad access; all grants stay in-organization.

### Transparency Requires A Pinned View Or Witnessing

The shared verifier has signed tree-head, inclusion-proof, and consistency
proof primitives for identity state heads, principal policy heads, and access
manifest heads. These prove that a returned leaf is in a signed log view and
that a newer log view extends a previous pinned tree head.

They do not, by themselves, prevent withholding or first-contact split views. A
client with no prior tree head, witness, gossip peer, or external checkpoint
can still be shown a self-consistent signed log view that differs from another
client's view.

### Availability Is Out Of Scope

The server can always deny service by withholding data, policy bundles,
key-target envelopes, or key lookup responses. The protocol fails closed when
required cryptographic policy material is unavailable.

## Information-Disclosure Scenarios

### Forged Group Or Organization Membership

If the signer identity key is authentic and the client receives the referenced
policy bundle, the server should not be able to add a user to a group or
organization merely by editing database rows. The forged projection would not
match the signed `projectionRoot`, the signed state hash, the chain, or the
admin-signer rule.

Result: detected and fail closed.

### Forged Organization Roster Membership

Org-manager directory lifecycle is stored in `organization_roster_entries`.
Active roster state is synchronized from users reachable through the reserved
`Members` group, and disabled rows may remain visible after access removal.
Group creation and policy writes require every named user to have an active
[roster entry](../glossary/principals.md#organization-roster-entry) in the same
organization, including ordinary groups and `Admins`. A `Members` removal
rechecks all live groups in the same transaction; signed removals from other
groups and direct container grants must precede disabling. Group membership
implies [organization membership](../organization-memberships.md) and a billed
seat. Historical projections remain available for verification after removal.

If roster or projection rows are edited directly, server-side directory and
listing surfaces can be distorted, but those rows are still not cryptographic
authority. Verified policy consumers must reject forged access unless the
signed `Members` policy state, chain, projection root, and admin-signer rule
also verify.

Result: fail closed for verified policy consumers; mutable directory or
projection rows alone are not authority.

### Tampered Principal Payload

If the encrypted principal payload is changed, the ciphertext hash no longer
matches the signed `payloadCiphertextHash`.

Result: detected and fail closed.

### Tampered Principal Key

If the principal encapsulation public key is changed, the key fingerprint no
longer matches the signed state, or the state signature no longer verifies.

Result: detected and fail closed.

### Replayed Older Principal State

If the replayed state is internally valid, signatures and hash-chain checks can
still pass.

Result: not reliably detected unless the client has remembered a newer
version/hash or checks an external transparency source.

### Forged Object Grant View

If the server changes projection rows and recomputes projection hashes, an
honest client should reject the view unless the signed access manifest, event,
referenced principal policies, predecessor checkpoint, and derived target hash
all verify.

Result: detected and fail closed for clients that require the verifier outputs
before encrypting. Clients that trust projection rows directly remain outside
this guarantee.

### Substituted First-Contact Signer Key

If the client has never pinned or independently verified a user's signing key,
a compromised server can return a fake signing key and a fake policy chain that
is internally consistent with that fake key.

Result: not reliably detected without prior trust in the identity key binding.

## Invariant Summary

- Signed principal policy state is the authority for group and organization
  crypto membership.
- Unsigned group or organization membership rows are not sufficient to create
  managed-principal crypto recipients.
- Organization-scoped group management is authorized through the reserved
  `Admins` group. A direct group admin has no separate server-side management
  authority unless that user is also an organization admin.
- Organization membership is verified from the reserved `Members` group, not
  from mutable roster rows or product roles on the organization principal.
- Principal policy bundles fetched by the app are verified before caching and
  make the receiving workflow fail hard on validation failure. Transport-level
  absence remains a recoverable cache miss, but hostile policy material does
  not degrade to that availability path.
- Principal member envelopes must match the active direct signed projection.
- Group membership and access shrink rotate affected KEKs atomically; stale
  group-grant references and organization successors with stale references are
  rejected.
- Organization policies commit every current group head. Group mutations
  atomically advance group and organization policies; share, membership, and
  rotation checks reject bundles that do not match that directory.
- Signed access manifests are the authority for object grant and document-link
  state used by key derivation.
- Object writes commit to the verified access manifest hash and derived target
  hash.
- Durable full-bundle identity pins detect identity changes after first use;
  local checkpoints detect replayed or conflicting principal policy and access
  manifest heads after a client has seen newer state.
- First-contact key substitution for identities not verified by an identity
  link, withholding, and split views without a pinned checkpoint, witness, or
  gossip peer remain outside the guarantee boundary.

## Strengthening The Boundary

Every API response and app workflow that drives encryption should require the
signed manifest, verified referenced principal policies, local checkpoint
comparison, and derived target hash before encrypting or decrypting.

Clients do not persist transparency tree heads. Split-view resistance beyond
the local monotonic checkpoints requires comparing signed tree heads through
device sync, gossip, witnesses, or an independently auditable checkpoint
stream.
