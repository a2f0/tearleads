# Security Guarantees

This document describes the security and validation invariants of the
Tearleads protocol.

For shared protocol terminology, see [glossary.md](./glossary.md).

## Short Answer

Given an honest, uncompromised client, the system can detect forged or tampered
signed group and organization policy state when the signer identity key is
authentic and the client receives the referenced policy bundle.

The system does not provide a universal guarantee that an honest client can
detect every compromised-server behavior. A compromised server can still deny
service, omit state, replay older valid state when the client has no
checkpoint, show split views to different clients without gossip or
witnessing, or substitute identity keys on first contact.

The confidentiality boundary is:

- The server cannot decrypt encrypted content without recipient private keys
  or unwrapped DEKs.
- The server cannot forge a valid signed group or organization policy state
  unless it controls an authorized policy signer key, can substitute the signer
  identity key trusted by the client, or can make the client accept invalid
  policy state.
- The server cannot make an honest client accept object grants or recipient
  targets that are not justified by signed access manifests and verified
  principal policy heads.

## Threat Model

The security properties assume:

- The client code is honest and runs the implemented validation paths.
- User signing and encapsulation private keys are not compromised.
- Cryptographic primitives hold.
- Clients do not intentionally ignore policy validation failures.
- Server-side API and database code may be malicious, compromised, stale, or
  inconsistent.

The properties are relative to the authenticity of registered user identity
keys. The client fetches each complete user identity through one strict gateway,
checks both key fingerprints, and durably pins the exact bundle by trust domain
and `userId`. Later substitutions hard-fail, and policy verification also checks
the signing fingerprint embedded in signed state. The first accepted response
is still TOFU, not a key-transparency or out-of-band identity proof.

## Protocol Handshake

The access and policy handshake has these layers:

1. User registration stores the user's signing key, encapsulation key, personal
   organization, reserved `Admins` group, reserved `Members` group, root
   container, root metadata state, optional roster-profile bootstrap material,
   and initial signed principal policies inside one registration transaction.
2. The initial `Admins` policy must project the registering user as the sole
   admin. The initial `Members` policy must project the registering user as an
   admin. The initial organization policy must be version `1`, must target the
   new organization, must be signed by the registering user, must project only
   the registering user as admin, and its version-2 authority descriptor must
   commit the exact initial `Admins` and `Members` policy heads.
3. Later group and organization policy states are signed principal states. The
   server verifies the signature, state hash, projection and envelope roots,
   encrypted payload hash, member count, previous-state link, and admin-signer
   rule before storage.
4. The signed state commits the exact direct-member envelope set. State,
   payload, projection, and envelopes are accepted atomically; the API rejects
   missing, extra, altered, or fingerprint-mismatched envelopes.
5. Access changes are represented as signed access events and derived access
   manifests. Manifests bind the object, organization, epoch, predecessor hash,
   event hash, structural hash, grant root, referenced principal heads, and
   key-target hash.
6. App clients fetch referenced principal policy bundles, verify them, and
   cache only bundles whose signed state chain matches the object reference.
7. App clients unwrap group or organization addressed object envelopes only
   through verified cached principal policies, valid member envelopes, and signed
   access manifests.
8. Writes commit to the verified access manifest hash and derived recipient
   target hash so stale or forged access views fail verification.
9. Clients persist exact full-bundle identity pins and monotonic checkpoints for
   principal policy heads and access manifest heads.
10. Terminal trust-boundary verification failures are appended to a local
    security-incident ledger before the workflow rethrows them. The ledger is not
    part of remote-state reset and contains typed codes and object references, not
    exception text or decrypted data.

## Security Properties

### Principal Policy Integrity

A principal signature binds its type/id, version and predecessor, key epoch and
encapsulation key, membership/projection/envelope roots, encrypted payload
hash, member count, signer identity, and timestamp. The server validates this
before storage; API authorization consumers and clients revalidate complete
chains before use. Projection rows are therefore not authority by themselves:
changing them without a matching signed state causes rejection.

### Admin-Signer Authorization

Every signed principal-state header includes `externalAuthority`. It is `null`
for a signer authorized directly by the initial or preceding projection. An
externally authorized organization-group state instead commits the exact
reserved `Admins` policy head. The API accepts only its current exact head and
a direct `admin` signer; organization and Admins states cannot cite it.

Verification resolves every non-null citation to that exact Admins
history entry and tests its projection, rather than unioning historical admins.
Successors may cite historical heads after Admins advances. Citations cannot
roll back within a chain; policies must descend from local checkpoints. Clients
refuse only what an honest server cannot produce, so accepting honest history
never depends on another device's cache or write.

A removed admin with a compromised server can append using historical authority
until a current admin's successor cites newer authority, final for clients
that observed that advance. The API requires current authority at commit;
proving currentness needs witnessing or gossip (#1555).

The signed organization descriptor selects `Admins`; display and read-model
projections never authorize policy or keying. Root and metadata repairs use
verified grants.

There is no legacy or unsigned fallback. Pre-contract signed state must be reset
and its organization reprovisioned, not translated.

### Principal Payload And Projection Binding

The principal state's `projectionRoot` must match the supplied projection. The
state's `payloadCiphertextHash` must match the supplied encrypted payload. The
state's `memberCount` must match the projection length. Its
`memberEnvelopesRoot` must match the canonical exact envelope set.
The signed `grantRoot` and `grantCount` likewise commit the complete canonical
set of `{containerId, accessLevel}` grants for that principal. Current and
historical policy bundle entries carry those grant projections, and both the
client and API recompute the commitment before accepting them.

This grant-index protocol is a greenfield flag-day. Grant commitments are part
of signed state hashes and cannot be truthfully backfilled. Deployment must
drop and recreate pre-grant-index API databases and local client databases;
the client fails startup with a reset-required error if it detects the legacy
principal-policy table shape.

The group display name is committed in the signed group payload. The
`groups.name` column and the organization read model are listing aids; when a
member shares a container with a group they chose by name, the client checks
that name against the verified payload and fails closed on a mismatch, so a
relabeled read-model row cannot redirect a share onto another group. Signed
names are unique within an organization because conforming clients enforce
it: group creation verifies every group in the signed directory before
committing a new name. The server does not index group names uniquely, and a
compromised server cannot mint a signed group, so the client-side check is the
only one. Two admins creating the same name at once cannot both succeed: each
creation commits a successor of the signed organization directory, and the
API rejects a successor that does not cite the current directory head, so the
loser reloads the directory and re-runs the check. This is also a greenfield
flag-day. A group signed before names were committed fails every policy
mutation and every share; reprovisioning is required. With old API instances
stopped, deployment rejects unnamed group payloads before rollout.

Membership writes bind the label to the verified signed policy before
recipient resolution, wrapping, or signing. Add and remove refuse mismatches.
Group creation binds its listing name to the signed name; every successor
must preserve it. Known gap: grant-revoke labels remain unbound.

The app repeats these checks on fetched policy bundles. A bundle with a
tampered projection, payload, state hash, chain link, signer, or checkpoint
raises a typed terminal verification error. It is neither cached nor used for
decryption, and the policy-warming or recovery workflow that received it
aborts instead of reporting success.

### Local Security-Incident Detection

The client records typed keying-verification failures from document sync,
container reconciliation, managed-principal operations, and the trusted-user
identity gateway. Recording happens before the original terminal error is
re-thrown, and an exact error object is recorded only once even if it crosses
several instrumented boundaries. A host callback or subscriber cannot replace
the verification failure if it throws. Ordinary network and local-database
availability failures remain retryable operational errors and are not labeled
as tampering.

An incident proves that the received or stored material failed a local
verification rule. It does not by itself prove that the server was malicious;
corruption and implementation defects can produce the same signal.

### Member Envelope Binding

The signed `memberEnvelopesRoot` commits one canonical envelope per direct
member: identity, active state/epoch, recipient fingerprint, KEM ciphertext,
and wrapped key. Exact ML-KEM-1024/AES-GCM formats are enforced, and state,
payload, projection, and immutable envelopes commit in one transaction. The
server still cannot create a valid new wrap without the principal secret key.

### Revocation Depends On Principal Key Rotation

`keyEpoch` and the principal key fingerprint are signed and participate in
object references to group policy state. That lets clients
detect mismatches between an object reference and the policy/key epoch used to
decrypt it.

Validation records and checks key epochs, but membership removal only protects
subsequent object envelopes when the principal key rotates. If a removed member
previously learned the old principal secret key and a later state keeps the
same principal key, that member can still decrypt later object envelopes
addressed to that unchanged key. Strong post-removal confidentiality requires
publishing a successor policy state with a fresh principal key epoch and fresh
member envelopes for the remaining members.

### Managed Grants Fail Closed

Group container grants require an active signed group state. If a
managed principal grant cannot be resolved to active signed state, recipient
resolution fails rather than degrading to unsigned expanded users.

This prevents unsigned group rows from creating crypto recipients. Organization
policies commit authority, not container grants.

### Signed Access Manifests

Access manifests are deterministic, signed commitments to the access state used
for key derivation:

- container manifests include container identity, parent edge, metadata
  document identity, direct grants, referenced principal heads, predecessor
  hash, and key target hash
- document link-set manifests include document identity, linked containers,
  predecessor hash, and key target hash
- attachment, document, and blob key targets are derived from verified
  manifests rather than API-provided recipient lists

Clients should commit writes to the verified manifest hash and derived target
hash. Projection hashes may still be useful cache keys, but they are not the
authorization source.

Document purge is likewise a signed terminal event. It commits the exact
document head and sole authorizing container head, and requires signer write
access through that path. The API retains the event and manifest evidence after
content deletion. On another device, a coded not-found response is only a
prompt to fetch that proof; the SDK deletes local state only after independently
verifying it against pinned identities and local checkpoints. A later pinned
authorizing-container head makes the proof fail closed because its ordering
relative to the purge is not signed. Document predecessor history can still
advance an older document checkpoint to the purge-time head.

A container manifest pins the parent manifest it was created or moved under,
and successor manifests inherit that pin, so the pin does not say which
ancestor heads a later grant, revoke, or rekey was authorized under. Those
heads are signed into the event: every container event cites the manifest
hashes of the path it was committed against, and the API refuses an event
whose citations are not the current heads at commit time. The client
authorizes a head's signer against the cited heads, rebuilt root to parent
from the served bundles, rather than against whatever path the server pairs
with the manifest. For every ancestor, a head must cite a head that is or
descends, through verified predecessors, from the head an earlier signed
statement already established, so neither an older head nor a same-epoch fork
of that ancestor can authorize a later child event. A served path must be a
root-to-leaf chain of parent edges, checked by container id. Document link
events are authorized through dependency container paths served the same
way; those are verified at the membership they referenced and without
checkpoint enforcement, because a historical link legitimately cites the
container heads current when it was signed. The checkpoint-enforced
authorizing path recorded for a leaf takes precedence over any dependency path
served for the same leaf, whatever order the server lists them in. Whether a
link's container evidence predates a later rotation of that container is the
same ordering boundary as for container heads.

Neither container nor principal-policy verification requires a successor new
to a device to cite the authority's served current head. An honest
server routinely serves a descendant head that cites the ancestor head
current when it was committed, signed by a member since revoked at that
ancestor, and a device cannot tell that member's last honest event, delivered
late, from one committed afterwards with the server's help. Refusing the
shape would leave every device that already holds the descendant unable to
supersede its head, since every mutation verifies the same projection first,
so a device's ability to read or write would depend on another device with no
history for the container. The API refuses the forgery at commit, and the
lineage rule above makes the next legitimate event on the descendant final.
The residual is that a member revoked at an ancestor, with a compromised
server, can keep authority over a descendant until that next event; a
best-effort re-cite of the descendants a revoking client already holds
shortens that window without any device depending on another. What the
client does refuse is the opposite disagreement: a served current ancestor
head that does not descend from a head a child's signed event cites is a
stale or forked ancestor, whatever the server calls current, since the
signature proves the cited head exists.

Container mutation workflows (share, revoke, rekey, and move) and atomic
group-policy rematerializations schedule a best-effort descendant re-cite
after exact acknowledgement. The SDK retains at most 256 verified or locally
acknowledged container heads and 512 organization-scoped verified policies per
SQLite executor. It reconstructs held paths from parent IDs, checks each against
its durable checkpoint, and signs complete path citations parent-first.
`container.recite` changes only the access-manifest head: grants, parent pins,
key epochs, keyrings, and wraps stay unchanged. The API checks current paths
and principal policies under the mutation locks and requires admin authority.
The signed transition stops admitting re-citations once the prior container
epoch reaches 512. This leaves at least 512 ordinary same-key mutations before
the 1024-entry write-history bound, even without a prior rekey. Re-citations
cannot restart their allowance by rekeying. They also reserve most of the
API verifier's 4096-manifest
history budget (`MAX_CONTAINER_HISTORY_DEPTH` in
`packages/api/src/workflows/containers/writerProjection/storedManifestVerification.ts`)
for ordinary mutations; it is not history compaction. The SDK
skips signing at that boundary, and the API independently rejects it.

Every successful re-cite permanently adds one manifest to the descendant's
history. Writer projections return and re-verify that chain, so repeated
ancestor changes can increase per-read bytes and verification cost up to this
bound even when the descendant itself is never edited. Re-citation also
advances `metadataAccessStateHash`: each accepted event invalidates the
organization grants lane and emits the normal container/access hints. It also
advances `containers.updatedAt`, re-emitting the container in incremental lists.
A full eight-attempt pass can add eight organization-wide refreshes to one
user mutation. These invalidations are not batched; the per-pass cap and pacing
bound amplification, not the total cost of later reads or refreshes.
Each signed re-cite is an independent HTTP transaction, including when a client
stops midway through a pass. Its cursor must commit with its new manifest so a
reader between requests, or after that interruption, sees the new access
identity. There is no server-side pass transaction whose final request can
safely replace those durable invalidations. This is the bounded one-mutation-
per-held-descendant cost selected in #2171, not a batch notification protocol.
The authoring API client also invalidates its container/document
writer-projection caches after each request, so a full pass can clear them
eight times.

Document/blob writes also walk each ancestor's same-KEK manifest history to
validate key bindings. That SQL walk admits at most 1024 manifests per container,
using the independent API `MAX_SAME_EPOCH_MANIFEST_HISTORY` limit, with one
overflow sentinel; it fails closed and requires a rekey beyond that
boundary. It uses constant-size recursive rows and detects duplicate hashes
after loading, rather than accumulating quadratic visited-path strings. This
separate write-side bound applies to ordinary grant/move events too. A rekey
starts a new same-KEK run; it does not compact the signed writer-projection chain.
This is an intentional greenfield flag day: already-persisted histories above
the same-key bound are refused too, with no compatibility migration. The bounds
tests construct persisted stable/changing-grant runs before the first read
and exercise both refusal and recovery after rekey.

This background pass never fetches a subtree or a principal policy, never
retries a failed re-cite, and never delays or changes the original mutation's
result. One pass runs per executor, capped at eight attempts with a 250 ms gap
between requests. The cap, overlap, eviction, missing evidence, stale policies,
conflicts, and cancellation can leave descendants untouched.
The per-pass cap and pacing are advisory SDK limits, not API rate limits.
An authorized admin using another client can fill the allowed history budget
quickly and permanently increase read cost; server rate limiting is not provided.
Acknowledgements that contradict the signed plan are reported through the
host's security-incident reporter without advancing the descendant checkpoint.
Network refusals remain best effort and do not become integrity incidents.
There is no dependency on another device's cache and no new read-time currency
rule. Re-citation narrows the residual authorization window when it succeeds;
it does not rekey descendants or promise post-revocation confidentiality.

### Content Confidentiality

Encrypted document, blob, and metadata content remains confidential from a
server that only has stored ciphertext and wrapped keys. The server needs a
recipient private key, a principal secret key, or an object DEK to decrypt.

The content-record suite `aes-256-gcm-hkdf-sha256-record-key` applies only to
document and blob payload records. Document and blob content-key wraps use
explicit `tearleads.*.content-key-wrap.aes-256-gcm-container-kek` suites, while
container KEK wraps use ML-KEM-1024 plus AES-GCM for principals or AES-GCM
under a parent or successor KEK. Rotations write two artifacts: a write-once
predecessor bridge under the
`tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek` suite (the
append-only log) and the complete predecessor key history sealed under the
`tearleads.container-kek-keyring.aes-256-gcm-current-kek` suite (the snapshot
current clients open for history). Each rotation event signs both canonical
hashes; AES-GCM additionally binds the container and epoch ids during
decryption, and the sealed keyring's ciphertext length is an equality in the
epoch number, enforced server-side at write time. A keyring for epoch `n` must
open to exactly `n - 1` entries, each verified against its
material-committing epoch id, so omission, reordering, and padding all fail
closed.
Failure to verify a keyring makes that history unavailable but does not
invalidate an independently verified current KEK; current-epoch reads continue
while operations that require the damaged epochs fail explicitly, and the
bridge log (`GET /containers/:id/kek-log`) remains the deterministic rebuild
path — any current member walks the write-once bridges from the current KEK,
verifies every recovered key by its epoch-id commitment, and repairs the
snapshot with an ordinary `container.rekey`.
This deliberately changes compromise amplification: possession of the current
container KEK also reveals every retained predecessor KEK through the sealed
keyring. That is the cost of history-inclusive current access. It does not
weaken forward revocation—a user who lacks a post-revocation KEK still cannot
derive that KEK or later epochs—but current-key compromise exposes retained
historical content for that container. Current members also learn
retained-history metadata—including rotation count (from the keyring length),
epoch ids and numbers, access-manifest hashes, and parent epoch
references—even though the sealing still protects the old plaintext keys. A
descendant path may carry this ciphertext metadata for ancestor epochs even
when that descendant-only member cannot unwrap the ancestor KEKs.

The server validates the signed artifacts' shape, length equality, and hash
commitments but cannot validate their plaintext without a KEK. A malicious
authorized writer can therefore sign undecryptable ciphertext and deny access
to predecessor history. This is an explicit availability limitation with a
bounded blast radius, not a confidentiality bypass: a poisoned keyring is
rebuilt from the bridge log; a poisoned bridge orphans only the epochs below
it for members who joined after it, because cross-epoch recipient wraps are
retained forever (a stated protocol invariant) and any member present at an
earlier epoch can recover that epoch's KEK from server state alone and
re-anchor a repair rekey. The composition of these recovery paths is model
checked in `formal/container-keying/KeyringReachability.tla`. Supported
clients generate fresh successor keys and round-trip both artifacts before
sending a mutation.

That recovery backstop is bounded by which envelopes the kek-log will serve.
Principal key rotations and membership changes atomically rematerialize every
retained group container grant against the new current principal head. The
material cases are:

- **Group key rotated, member still authorized.** The replacement container
  wrap names the current group head, so a fresh client resolves it through the
  current verified group policy. No historical principal key is required.
  **Recoverable.**
- **Member removed from the group.** The replacement wraps are not readable by
  the removed user. **Not recoverable while unauthorized.**
- **Member later re-added.** The user receives the current group key and the
  retained container grant is rematerialized against the current head. A fresh
  recovery-key login can therefore recover the still-granted container without
  a repair action by another user. **Recoverable.**
- **Group deleted.** `deleteOrganizationGroupRows` purges the group's encrypted
  payloads, epoch keys, and member envelopes. It retains only signed public
  state and committed membership/grant projections so terminal purge proofs
  remain verifiable. The key material is gone from the server, so a later
  recovery cannot reconstruct it. **Permanently unrecoverable from server
  state**, by design. This is not a client-side erasure guarantee: a client that
  cached the group key while authorized still holds that material.
- **Anchor caps.** The per-epoch envelope cap and the principal-scope cap rank
  candidates by identity, not by whether the client can resolve them. A
  requester with a very wide principal set can be served envelopes they cannot
  open while one they could open sorts past the cap.

The requester's direct user envelope and their parent-container envelopes are
scoped outside the principal cap and rank ahead of principal envelopes, so the
anchors needing no policy state at all are never what a cap costs.

All container KEK epochs use a
`tearleads.container-kek.v1.sha256:<hash>` id, clients verify that the
decrypted KEK material matches the signed epoch id before using that KEK to
wrap document or blob content keys. Non-prefixed ids are rejected because they
do not commit to the decrypted key material.

When clients use verified principal policy bundles, a forged group or
organization policy state should fail closed before the client unwraps a
principal-addressed object envelope.

### Local At-Rest Key Wrapping

The SDK local keyring is a host-facing at-rest key management layer. It stores
a manifest containing a wrapped account-root secret and derives local SQLite,
blob-store, identity-persistence, and custom-purpose keys from that root. The
manifest is not itself a keychain; confidentiality depends on the host
`WrappingKeyKeystore` implementation, such as a browser, desktop, iOS, or
Android secure-storage primitive.

The wrapped account-root envelope binds its purpose and normalized scope as
authenticated context. A manifest for one namespace, account id, or signing
fingerprint should not unwrap under another scope. The memory keystore and
manifest store exported by the SDK are test/development helpers only and do
not provide durable platform protection.

PIN-code local keyring support is an optional wrapper over a host keystore. In
that mode, the account-root secret is wrapped by the inner keystore and then
the inner envelope is encrypted with a PBKDF2-SHA256/AES-GCM key derived from
the supplied PIN. Reopening the local session requires both the host wrapping
key and the PIN; the default browser local keyring does not require a PIN.

This local keyring protects local database and blob-store keys at rest on the
client device. It does not change server-side access authorization, signed
manifest verification, content-key bundle validation, or remote ciphertext
confidentiality.

## Boundaries

### No Universal Compromised-Server Detection

The server can withhold data, omit newer state, replay valid history, show split
views, return projections inconsistent with signed manifests, or substitute
identity keys on first contact. Validation makes many of these fail closed, but
is not global transparency unless clients pin or witness tree heads.

### Rollback And Split-View

Principal state hash chains detect inconsistent chains. They do not, by
themselves, prove that the returned head is the latest head.

A server that has older valid signed states can replay an older valid chain
unless the client has an independent monotonic checkpoint, highest-seen
version/hash pin, or transparency log. Production clients persist checkpoints
and reject rollbacks or same-version hash conflicts for principal policy and
access manifest heads. User identity trust currently uses an exact durable
full-bundle TOFU pin: any later change to either public key, fingerprint, suite,
or format is rejected.

The organization policy also commits an exact sorted directory of current group
heads. Group mutations issued by supported clients advance the group and this
directory atomically. Group share and rotation-staleness workflows verify the
organization policy and require an exact directory match, so replaying only an
old group head is detected even before that group has a local checkpoint. A
server that replays a self-consistent older organization policy, reserved
Admins policy, and group policy to a device with no organization checkpoint is
still exercising the cold-start rollback limit above.

### First-Contact Identity-Key Substitution

The app fetches signer public keys from the server by `userId` and verifies
that the returned key fingerprint matches the fingerprint embedded in signed
policy state.

That catches malformed responses. It does not, by itself, prove that the
server gave the client the real public key for a user the client has never seen
before. A compromised server that controls the first key lookup can construct a
coherent fake signer identity unless clients have a previously pinned key, an
out-of-band identity check, or a key-transparency mechanism.

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
signed grant projections, never from the organization read-model grant lane.
The API independently compares that signed union with current verified
container manifests and requires exactly one matching mutation for every
added, changed, removed, or stale grant. A server omitting one container can
therefore cause only a failed transaction, not a falsely successful rotation.
A cold client needs only current policy and container state. Group grant revoke
rotates the group and its remaining grants; standalone group revokes are
rejected, while grant-level `read`/`write`/`admin` remains unchanged.
Organizations cannot receive container grants. Reserved groups provide broad
access; all grants stay in-organization.

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
`Admins` is no longer nested into `Members`, so admins are not members by
construction. Instead the policy write refuses any managed principal naming a
_disabled_ roster user, and refuses `Admins` specifically unless every user it
names is an _active_ roster entry — including after a `Members` transition,
which is re-checked against `Admins`. An admin is therefore always an active
organization member, and always counted as a seat. Ordinary groups may still
name users who are not in `Members`, exactly as they could under nesting.

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
- First-contact key substitution, withholding, and split views without a
  pinned checkpoint, witness, or gossip peer remain outside the guarantee
  boundary.

## Strengthening The Boundary

Every API response and app workflow that drives encryption should require the
signed manifest, verified referenced principal policies, local checkpoint
comparison, and derived target hash before encrypting or decrypting.

For stronger split-view resistance, clients should persist transparency tree
checkpoints and compare signed tree heads through device sync, gossip,
witnesses, or an independently auditable checkpoint stream.
