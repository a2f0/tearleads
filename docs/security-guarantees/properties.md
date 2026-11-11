# Security Guarantees: Security Properties

Part of the [security guarantees](../security-guarantees.md).

## Security Properties

### Principal Policy Integrity

A [principal signature](../protocol-specification/identity-and-policy.md#principal-policy-protocol)
binds its type/id, version and predecessor, key epoch and encapsulation key,
membership/projection/envelope roots, encrypted payload hash, member count,
signer identity, and timestamp. The server validates this before storage; API
authorization consumers and clients revalidate complete chains before use.
[Projection rows](../glossary/sync.md#projection-row) are therefore not
authority by themselves: changing them without a matching signed state causes rejection.
Every principal-state write, including group creation and provisioning,
re-verifies the stored chain from rows inside the storing transaction before
commit.

### Login Challenges Name The API

A [login signature](../protocol-specification/identity-and-policy.md#identity-and-session-handshake)
covers the challenge, the signing-key fingerprint, and the API's canonical
origin. The API checks it against its configured `API_PUBLIC_ORIGIN`, which
production requires as a bare https origin. A challenge that a malicious API
relays from the real one was therefore signed for the relay's origin and never
verifies. Outside production an unset origin falls back to each request's own
origin, which comes from its Host header and which a relay controls. The API
warns about that fallback at startup.

### Signed Timestamps

Every signed `signedAt` is canonical `Date#toISOString()` form with a year in
1970-9999, the only range a `timestamp` column serves back verbatim (0001-0099
hit the two-digit-year pivot; expanded years are rejected). Shared readers
enforce this on both sides, and the API asserts inside the storing transaction
that the written row prints the exact submitted string, so an irreproducible
header never commits. Honest clients sign `Date.now()`, so no honest data is
refused; a failing header is a malformed request, not an unauthorized signer.

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
proving currentness needs witnessing or gossip.

The signed organization descriptor selects `Admins`; display and read-model
projections never authorize policy or keying. Root and metadata repairs use
verified grants.

Policy verification requires the current signed state contract.

### Principal Payload And Projection Binding

The principal state's `projectionRoot` commits each member's user ID, role, and
required `identityBundleFingerprint`, the complete
[identity-link bundle commitment](../developer/trusted-user-identity.md#signed-member-identity-commitments).
It must match the supplied projection; continuing members cannot change that
bundle. `membershipRoot` remains an ID-set commitment. The
state's `payloadCiphertextHash` must match the supplied encrypted payload. The
state's `memberCount` must match the projection length. Its
`memberEnvelopesRoot` must match the canonical exact envelope set.
The signed `grantRoot` and `grantCount` likewise commit the complete canonical
set of `{containerId, accessLevel}` grants for that principal. Current and
historical policy bundle entries carry those grant projections, and both the
client and API recompute the commitment before accepting them.

Grant commitments are part of signed state hashes. Local startup validates the
required principal-policy columns before using cached policies.

[Document](../glossary/content.md#document) and attachment events also sign
their full authorization paths, deduplicated. Verification rebuilds paths by
parent id from those citations, never from creation-time pins. Missing ancestors
or two heads of one container are rejected. Runtime readers verify every
signature, hash, and cited path.

Custom group names are encrypted inside their signed policy payloads with
AES-256-GCM and a domain-separated key derived from the organization metadata
[container KEK](../glossary/keys.md#container-kek). Authentication binds the group,
organization, container and key epoch. All organization members can read every
group's name; the verified
[historical keyring](../glossary/keys.md#container-kek-keyring) preserves readability
after [rotation](../glossary/keys.md#rotate). The API has no group or organization
name columns. Organization names live in encrypted profiles. The API refuses
names citing other keys. A name that fails to decrypt is left blank and skipped
for uniqueness, never failing the directory.

The organization metadata root has only Admins/admin and Members/read grants.
Both signed group indexes bind its ID; creation also verifies its current
projection and checkpoint. It never inherits personal-root shares or depends
on personal-root rotations. Members rotations update its own KEK; historical
names remain readable through its authenticated keyring.

Reserved Admins and Members labels are client constants. Their random group
IDs and roles are authenticated by the signed organization descriptor; their
roles and memberships remain visible to the service. They are not identified
by server-provided display names.

Before displaying or acting on a name, clients verify the group's signed
directory binding and decrypt its metadata. Creation checks name uniqueness
against that directory. Membership and grant successors retain the ciphertext;
local decrypted display caches never enter API requests.

The app repeats these checks on fetched policy bundles. A bundle with a
tampered projection, payload, state hash, chain link, signer, or checkpoint
raises a typed terminal verification error. It is neither cached nor used for
decryption, and the policy-warming or recovery workflow that received it
aborts instead of reporting success.

### Local Security-Incident Detection

The client records typed keying-verification failures from document sync,
container reconciliation, [managed-principal](../glossary/principals.md#managed-principal)
operations, and the trusted-user identity gateway before re-throwing the
original terminal error. An exact error object is recorded only once even if it
crosses several instrumented boundaries. A host callback or subscriber cannot
replace the verification failure if it throws. Ordinary network and
local-database availability failures remain retryable operational errors and are
not labeled as tampering.

An incident proves that the received or stored material failed a local
verification rule. It does not by itself prove that the server was malicious;
corruption and implementation defects can produce the same signal.

Incident identities hash the evidence set in code-unit key order, so the same
evidence yields one id on every device and locale and repeat observations
merge; backup restore recomputes that identity and rejects non-canonical text.

### Member Envelope Binding

The signed `memberEnvelopesRoot` commits each direct member's identity,
recipient fingerprint, KEM ciphertext, and wrapped key. The signed state binds
the root and key epoch; verification checks the envelope bundle's state hash
and epoch. Principal signatures and hashes bind `tearleads.principal-state`.
Exact ML-KEM-1024/AES-GCM formats are enforced. State, payload, projection, and
envelopes commit atomically; the server cannot wrap without the principal key.

### Revocation Depends On Principal Key Rotation

`keyEpoch` and the principal key fingerprint are signed and participate in
object references to group policy state, so clients can detect mismatches
between an object reference and the policy/key epoch used to decrypt it.

Validation records and checks key epochs, but membership removal only protects
subsequent object envelopes when the principal key rotates. If a removed member
previously learned the old principal secret key and a later state keeps the
same principal key, that member can still decrypt later object envelopes
addressed to that unchanged key. Strong post-removal confidentiality requires
publishing a successor policy state with a fresh principal key epoch and fresh
member envelopes for the remaining members.

### Managed Grants Fail Closed

Group [container grants](../glossary/access.md#grant) require an active signed group
state. If a managed principal grant cannot be resolved to one, recipient
resolution fails rather than degrading to unsigned expanded users, so unsigned
group rows cannot create crypto recipients. Organization policies commit
authority, not container grants.

### Signed Access Manifests

[Access manifests](../keying-design/access-manifests.md#signed-access-manifests)
are deterministic, signed commitments to the access state used for key derivation:

- container manifests include container identity, parent edge, metadata
  document identity, direct grants, referenced principal heads, predecessor
  hash, and key target hash
- [document link-set manifests](../glossary/access.md#document-link-set-manifest)
  include document identity, linked containers, predecessor hash, and key target
  hash
- attachment, document, and blob [key targets](../glossary/keys.md#key-target) are
  derived from verified manifests rather than API-provided recipient lists

Clients verify [attachment bind](../glossary/content.md#attachment-binding)
events at referenced membership. Detach events are verified only by the API: no
client-consumed projection serves them (the attachments listing returns live
bindings and their bind events), so a detach is observed as the binding's
absence, not as an event the client checks. Clients commit writes to the
verified manifest hash and derived target hash. Projection hashes may be useful
cache keys, but they are not the authorization source.

Document purge requires a signed terminal event, verified write authority, and
an exact local document pin or a signed chain from a pin or genesis. Later
checkpoints anywhere on its
[authorizing path](../glossary/access.md#authorizing-container-path) withhold deletion
without a false integrity incident; signatures and visible forks are still
checked. Currency is rechecked inside atomic teardown. See
[document purge verification](../document-purge-verification.md) for the retained
evidence, retry behavior, and ordering limitation.

A container manifest pins the parent manifest it was created or moved under,
and successor manifests inherit that pin, so the pin does not say which
ancestor heads a later grant, revoke, or [rekey](../glossary/keys.md#rekey) was
authorized under. Those heads are signed into the event: every container event
cites the manifest hashes of the path it was committed against, and the API
refuses an event whose citations are not the current heads at commit time. The
client authorizes a head's signer against the cited heads, rebuilt root to
parent from the served bundles, rather than against whatever path the server
pairs with the manifest. For every ancestor, a head must cite a head that is or
descends, through verified predecessors, from the head an earlier signed
statement already established, so neither an older head nor a same-epoch fork
of that ancestor can authorize a later child event. A served path must be a
root-to-leaf chain of parent edges, checked by container id. Document
link-set heads and history, and the dependency container paths served for
them, are verified at the membership they referenced (the paths without
checkpoint enforcement), because a historical link legitimately cites the
container heads current when it was signed. Every document and attachment
event, including a document head new to this device, selects exactly its
signed full-path citations. A checkpoint-enforced current path cannot replace
an event's cited ancestor. Nor can a citation set mix an older or forked
ancestor with a descendant whose own signed citations prove a newer ancestor
exists. Both client and stored-document verification enforce these lineage
floors; consistent historical snapshots remain valid. Document and blob
[content-write headers](../glossary/content.md#signed-write-header) sign the sorted,
unique union of the full authorizing container paths. The API requires exact
current paths at submission and retains their cited bundles with the ciphertext.
Historical reads reconstruct those signed paths with the same lineage floors,
using the group membership at each cited head. The original parent pin and a
newer group snapshot cannot replace write-time authority. Every cited path must
belong to a linked container or the explicit link/unlink target, including
ancestor evidence already in those paths. One writable linked path proves
access; committed key targets still cover every linked container. Content-write
citations must use the manifest head committed by the matching content-key
target. Attachment bind events likewise use referenced membership when read and
current membership when submitted. Runtime tests cover scope and target
matching. The bounded
[ContentWriteAuthority model](../../formal/document-sync/ContentWriteAuthority.md)
assumes verified citations and checks historical membership and submission
freshness, with negative controls for both.

Semantic-currentness witnessing is out of scope: a new-to-device document
head, content-write header, or attachment binding signed by a since-revoked
member can be accepted at its complete historical citations, including a
content write whose target leaf has not advanced. This is also the shape of an
honestly delayed head. The API enforces current paths at commit; clients do not
claim to distinguish it from a later forgery assisted by the server. Existing
document checkpoints still reject rollback and forks.

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
server, can keep authority over a descendant until that next event. The bounded
re-citation described below advances descendants already held by the mutating
client, without claiming complete subtree coverage. On a checkpoint-enforced
current path, the client does refuse the opposite disagreement: a served
current ancestor head that does not descend from a head a child's signed event
cites is a stale or forked ancestor, whatever the server calls current, since
the signature proves the cited head exists.

### Held descendant re-citation

Container mutation workflows (share, revoke, rekey, and move) and atomic
group-policy rematerializations schedule a best-effort descendant re-cite
after exact acknowledgement. The SDK retains at most 256 verified or locally
acknowledged container heads and 512 verified policies total per canonical
SQLite executor, shared by its locked wrappers and across organizations.
Snapshots remain organization-scoped. It reconstructs held
paths from parent IDs, checks each against
its durable checkpoint, and signs complete path citations parent-first.
Before signing, it calculates current admin access from those trusted states
and held verified policies using the crypto access rules. Self-revocation
therefore skips descendants locally; a server cannot obtain an unauthorized
signed re-cite to echo into the durable checkpoint. Mutation lifetime also pins
a monotonic internal session generation, so logout/login expires pending work
even if no guard call observes the intermediate logged-out state.
Each policy used by a plan must match its durable policy checkpoint before
signing and submission. The acknowledgement transaction compares those exact
policy pins and every cited container checkpoint again before advancing the
descendant. Concurrent membership or ancestor-grant revocation therefore
cannot turn stale held evidence into a locally accepted head.
`container.recite` changes only the access-manifest head: grants, parent pins,
key epochs, keyrings, and wraps stay unchanged. The API checks current paths
and principal policies under the mutation locks and requires admin authority.
The signed transition stops admitting re-citations once the prior container
epoch reaches 512. This leaves at least 512 ordinary same-key mutations before
the 1024-entry write-history bound, even without a prior rekey. Re-citations
cannot restart their allowance by rekeying. This is not history compaction.
The SDK skips signing at that boundary, and the API independently rejects it.

Local listing cursors use one cross-organization root feed and globally unique
container IDs for child/document feeds, matching the API's actual scope. An
organization purge clears the global root cursor and its owned feeds, not feeds
belonging to other organizations. Viewing a foreign shared container therefore
cannot leave a cursor in the viewer's namespace after that container is removed.

Every successful re-cite permanently adds one manifest to the descendant's
history. [Writer projections](../glossary/sync.md#writer-projection) return that
chain for clients to verify, and the server verifies any part of it without a valid
verification marker, so repeated ancestor changes can increase per-read bytes
and verification cost up to this bound even when the descendant itself is never
edited. Re-citation also advances `metadataAccessStateHash`: each accepted event
invalidates the organization grants lane and emits the container hint (no
eviction). It also advances `containers.updatedAt`, re-emitting the container in
incremental lists. A full eight-attempt pass can add eight organization-wide
refreshes to one user mutation. These invalidations are not batched; the
per-pass cap and pacing bound amplification, not the total cost of later reads
or refreshes. Each signed re-cite is an independent HTTP transaction, including
when a client stops midway through a pass. Its cursor must commit with its new
manifest so a reader between requests, or after that interruption, sees the new
access identity. There is no server-side pass transaction whose final request
can safely replace those durable invalidations. This is a bounded
one-mutation-per-held-descendant cost, not a batch notification protocol.
The authoring API client also invalidates its container/document
writer-projection caches after each request, so a full pass can clear them
eight times.

Document/blob writes also walk each ancestor's same-KEK manifest history to
validate key bindings. That SQL walk admits at most 1024 manifests per container,
using the independent API `MAX_SAME_EPOCH_MANIFEST_HISTORY` limit, with one
overflow sentinel; it [fails closed](../glossary/access.md#fail-closed) and
requires a rekey beyond that boundary (see
[limits.md](../limits.md#container-keying) for every history budget). It uses
constant-size recursive rows and detects duplicate hashes after loading, rather
than accumulating quadratic visited-path strings. This separate write-side bound
applies to ordinary grant/move events too. A rekey starts a new same-KEK run; it
does not compact the signed writer-projection chain. Persisted histories above
the same-key bound are refused. The bounds tests construct persisted
stable/changing-grant runs before the first read and exercise both refusal and
recovery after rekey.

This background pass never fetches a subtree or a principal policy, never
retries a failed re-cite, and never delays or changes the original mutation's
result. One pass runs per executor, capped at eight attempts with a 250 ms gap
between requests. The cap, overlap, eviction, missing evidence, stale policies,
conflicts, and cancellation can leave descendants untouched.
Rematerialization scopes held policies and authors to each signed plan's
organization, which may differ from the caller's current organization. The
one-active-pass guard remains connection-wide; a mixed-organization batch can
therefore leave other organizations' descendants for a later pass.
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

Encrypted document, [blob](../glossary/content.md#blob), and metadata content remains
confidential from a server that only has stored ciphertext and wrapped keys. The
server needs a recipient private key, a principal secret key, or an object DEK
to decrypt.

The content-record [suite](../cipher-suites.md#aes-256-gcm-symmetric)
`aes-256-gcm-hkdf-sha256-record-key` applies only to document and blob payload
records. Document and blob [content-key](../glossary/keys.md#content-key) wraps
use explicit `tearleads.*.content-key-wrap.aes-256-gcm-container-kek` suites whose
AES-GCM AAD binds the suite, document or blob id, content-key epoch and target,
so a server cannot serve one document's or blob's wrap as another's, while
container KEK wraps use ML-KEM-1024 plus AES-GCM, sealed to a principal's key or
to the ML-KEM public key derived from the parent KEK; predecessor KEKs are
sealed under AES-GCM by their successor. Rotations write two artifacts: a
write-once [predecessor bridge](../glossary/keys.md#container-kek-predecessor-bridge)
under the `tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek` suite (the
append-only log) and the complete predecessor key history sealed under the
`tearleads.container-kek-keyring.aes-256-gcm-current-kek` suite (the snapshot
current clients open for history). Each rotation event signs both canonical
hashes; AES-GCM additionally binds the container and epoch ids during
decryption, and the sealed keyring's ciphertext length is an equality in the
epoch number, enforced server-side at write time. A keyring for epoch `n` must
open to exactly `n - 1` entries, each verified against its material-committing
epoch id, so omission, reordering, and padding all fail closed. Failure to
verify a keyring makes that history unavailable but does not invalidate an
independently verified current KEK; current-epoch reads continue while
operations that require the damaged epochs fail explicitly, and the bridge log
(`GET /containers/:id/kek-log`) remains the deterministic rebuild path — any
current member walks the write-once bridges from the current KEK, verifies every
recovered key by its epoch-id commitment, and repairs the snapshot with an
ordinary `container.rekey`. This deliberately widens what a key compromise
exposes: possession of the current container KEK also reveals every retained
predecessor KEK through the sealed keyring. That is the cost of
history-inclusive current access. It does not weaken forward revocation—a user
who lacks a post-revocation KEK still cannot derive that KEK or later epochs—but
current-key compromise exposes retained historical content for that container.
Current members also learn retained-history metadata—including rotation count
(from the keyring length), epoch ids and numbers, access-manifest hashes, and
parent epoch references—even though the sealing still protects the old plaintext
keys. A descendant path may carry this ciphertext metadata for ancestor epochs
even when that descendant-only member cannot unwrap the ancestor KEKs.

The server validates the signed artifacts' shape, length equality, and hash
commitments but cannot validate their plaintext without a KEK. A malicious
authorized writer can therefore sign undecryptable ciphertext and deny access to
predecessor history. This is an explicit availability limitation with a bounded
blast radius, not a confidentiality bypass: a poisoned keyring is rebuilt from
the bridge log; a poisoned bridge orphans only the epochs below it for members
who joined after it, because cross-epoch recipient wraps are retained forever (a
stated protocol invariant) and any member present at an earlier epoch can
recover that epoch's KEK from server state alone and re-anchor a repair rekey.
The composition of these recovery paths is model checked in
[`formal/container-keying/KeyringReachability.tla`](../../formal/container-keying/KeyringReachability.tla).
Supported clients generate fresh successor keys and round-trip both artifacts
before sending a mutation.

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
  payloads and member envelopes. It retains only signed public
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
`tearleads.container-kek.v2.sha256:<hash>` id committing to the container id,
numeric key epoch, and derived ML-KEM wrapping public key. Public verifiers bind
the advertised public key to that id; KEK holders independently derive the key
from decrypted material before wrapping document or blob content keys. Only the
v2 commitment format is accepted.

When clients use verified principal policy bundles, a forged group or
organization policy state should fail closed before the client unwraps a
principal-addressed object envelope.

### Local At-Rest Key Wrapping

The SDK [local keyring](../glossary/keys.md#local-keyring) is a host-facing at-rest
key management layer. It stores a manifest containing a wrapped account-root
secret and derives local SQLite, blob-store, identity-persistence, and
custom-purpose keys from that root. The manifest is not itself a keychain;
confidentiality depends on the host `WrappingKeyKeystore` implementation, such
as a browser, desktop, iOS, or Android secure-storage primitive.

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

This keyring protects local database and blob-store keys at rest on the
client device. It does not change server-side access authorization, signed
manifest verification, [content-key bundle](../glossary/keys.md#content-key-bundle)
validation, or remote ciphertext confidentiality.
