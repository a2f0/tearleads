# Historical policy evidence in writer projections

Container and document writer projections require `policyEvidence`: public
verification material for every principal citation in the served manifest and
KEK histories, including groups that were revoked, deleted, or are reachable
only through a document's other linked container. A fresh device can therefore
verify historical signatures without access to the cited group's current
policy endpoint. Projections without principal citations carry empty proofs
and disclose no directory.

Document paths carry no nested proof: the API loads one evidence set per
document response, and the SDK reuses its verified result across those paths.

The API authorizes the container or document before loading this evidence. The
response carries one organization history source, one source per required
group, and the directory payloads that bind those heads. Each source contains
an exact signed head reference and an object/user-scoped read grant. Each
directory payload includes the signed state reference that authenticates it.
Public history pages supply the complete signed predecessor chains without
group payload ciphertexts or member key envelopes, which group deletion erases.
Every page checks current access to the original object.

The SDK verifies signatures and predecessor chains, hashes each directory
payload against its signed organization state, and binds each supplied group
head to a signed directory entry. The group's authenticated chain supplies
older cited states. External group authority must belong to that
organization's Admins group. Existing durable checkpoints reject conflicting
chains. Missing required bindings, duplicate payloads, foreign groups, and
unsigned evidence are refused before manifest authorization. Unrelated
directory payload bodies are omitted.

Historical evidence does not become a current policy bundle or advance
principal checkpoints. Current key unwrapping requires encrypted member
envelopes and cryptographic unwrap under the requested signed key identity;
public authorization supplies no private key material. Current write
authorization remains subject to the server's policy and access checks. A
verified policy already held by an SDK mutation plan can cover its uncommitted
successor citation. Locally composed document links and container moves merge
the supplied evidence; ordinary remote projections provide it directly.

See the [NoBrickedDevice model](../formal/container-keying/NoBrickedDevice.md)
for history-only and deleted-authority delivery, bounded negative controls, and
the SDK implementation trace. API regressions exercise encrypted cold recovery
after group deletion and an active organization member reading a linked
document while direct access to its other container remains forbidden.

## Read authorization

A current container/document grant deliberately includes access to the public
verification closure of its signed history. That closure discloses membership
user ids, grant container ids, group public keys, signatures, and organization
directory ids across retained versions. Organization members can already read
full policy histories for live groups; this closure also serves the public
history of deleted groups. Management endpoints retain their own authorization
checks. Group names, group payload ciphertexts, and member key envelopes are not
part of this proof.

The protocol keeps this metadata contract and requires active organization
roster membership for every member of every live group. Group creation and
policy updates enforce that requirement transactionally. Removing a user
from Members is refused until signed removals from all other live groups and
direct container grants have committed. The app enrolls users in Members before
adding them to another group and removes ordinary-group memberships before
disabling the roster. No group mutation implicitly enrolls a user on the
server. Direct user grants independently require active same-organization
membership (`groupReferences.ts`); Members removal refuses outstanding direct
grants (`roster.ts`). There is no non-roster access exception.

A group's chain extends through its last directory-bound head rather than
stopping at the citation: a reader may already have checkpointed a later
version without retaining a full policy bundle, and serving only the cited
prefix would refuse that reader. History sources cover cited groups and their
Admins authority; unrelated group histories are not requested. Each supplied
directory body is authenticated by its hash in the signed state chain. Only the
bodies needed to bind the supplied heads are sent. Those bodies list every
group ID and head at their respective versions.

Each selected directory payload therefore discloses all group IDs and heads at
that version, although only cited groups and their Admins authority have
history sources attached. The organization's signed state chain also discloses
its public Admins roster history. That public metadata is part of the
historical-verification contract for current object readers; encrypted group
metadata and key envelopes remain outside it.

## Cost and retained-history tradeoff

The server retains complete signed organization and group histories. Projection
responses do not embed them. The API reads the current directory and indexed
last bindings for deleted groups, then delivers only the distinct payloads
needed for those bindings. A document shares one source set across its paths;
locally composed projections merge sources and retain older directory bindings.

Cold verification processes bounded history pages. Private authenticated
progress allows restart and selected citations use proofs against that verified
prefix. No server marker or public hash becomes a client trust anchor. Final
projection admission rechecks historical capabilities against current durable
pins without advancing principal checkpoints. See
[principal-history recovery](developer/principal-history-recovery.md) for the
private lease, checkpoint and availability contracts.

Writer projections carry each access-manifest bundle once, cited by hash (see
the [protocol
specification](protocol-specification.md#container-access-and-kek-protocol)).
After a projection verifies, the SDK stores its verified bundles in the local
`verified_access_manifest_bundles` table, keyed by manifest hash, and each
verified container KEK level as a typed row keyed by the SHA-256 of its
canonical wire bytes (one level per container, its latest). A later projection
GET for any object may send an `x-known-manifests` header listing up to 48 of
those typed digests (`KNOWN_MANIFEST_HINT_LIMIT`, `m:` for bundles, `k:` for
levels): the latest level of each container its projection walks first, then
the requested object's own lineage, then the lineages of the containers its
projection walks (its local ancestors, or the containers a document is linked
to, listed in, or describes as metadata, and their ancestors), then the
organization's most recently verified bundles. A container not yet stored
locally, such as a folder a hydration pass prefetches from a listing, follows
its listed parent's stored lineage. Citations never leave the object's
organization: every local source (verified bundles of the object and of the
containers on its walk, a document's verified discovery head, listed container
rows, and the listing that placed an unstored container) must name the same
single organization, and any disagreement or absence cites nothing. Citing is bounded:
a source that has not answered within 250 ms (`MANIFEST_CITATION_DEADLINE_MS`),
fails, or is overtaken by the caller's abort leaves the read uncited, and a late
answer is discarded. The citation is therefore shared across objects and
survives restarts and reconnects. The server performs its ordinary
authorization, lineage walk, stored-evidence verification and policy evidence
loading, then omits the bundle bytes of exactly the cited hashes it would have
served and lists them in the response's `omittedBundles`, and replaces each KEK
level whose served bytes have a cited digest with `{levelDigest,
containerManifestHistory}`. Unknown hashes are ignored; a rotated or rewrapped
level has a new digest and travels in full. The routes disable HTTP response caching.

The client fills each omission only from the exact bytes it cited for that
request, copied before the request was sent, and rejects a response that omits
anything else. The read binds its authentication context before citations
load; an account switch while they load, or before the refetch, cancels the
read rather than sending one identity's hints or answer under another's
session. A response it cannot rebuild is refetched once with no hints, which an
honest server answers in full; losing or emptying the table likewise yields
complete responses, so no device depends on a cache to read. Rebuilt
projections are verified from scratch: manifest hashes are recomputed, and
signatures, authorization, policy commitments, signer resolution, predecessor
links, directory binding, and durable rollback and conflict checks all run. A
stored bundle is evidence bytes, never a verification result, and a
server-supplied hash or marker never becomes a client trust anchor. Policy
evidence and current heads, keys and key material always travel. Stored rows
carry a SHA-256 digest of their exact JSON; a mismatched row is dropped instead
of cited.

Verified bundles are stored inside the transaction that advances, or for a move
destination re-validates, the projection's checkpoints. They commit only under
that transaction's generation and lease guard, and no cache write outlives the
verification or holds the database after it settles. The table keeps at most
1,024 bundles (`MAX_VERIFIED_MANIFEST_BUNDLES`) and evicts the least recently
verified first; eviction and an organization's remote reset only remove
citations. The API cannot skip loading a cited manifest: its own KEK
verification consumes the same states, and the policy evidence it serves must
cover every bundle the device re-verifies. Citation saves response bytes, not
server work. The [manifest history
model](../formal/container-keying/ManifestHistory.md) checks that citing only
held bytes and omitting only cited hashes keep every honest read available under
any eviction.

Principal-state and access-event signature results are separately memoized by
the exact signature, message bytes, and resolved public key. Only successful
signature mathematics is reused; no authorization result is inferred from that
cache. Its 8,192-entry budget evicts work, never refuses a chain. A larger chain
or working set can still require signature verification again. Principal chains
also retain at most 128 successful signature-history digests: each binds the
ordered transcript of exact signature bytes, canonical signed messages, and
resolved public keys. Every replay hashes all supplied inputs again, and only
an identical previously verified prefix can skip repeated signature mathematics.
An appended suffix is verified normally. A second pass checks that the source
has not changed while the transcript was computed. Cache eviction repeats work;
authorization, commitments, chain continuity, rotation and checkpoint checks
still run on every verification. Shape, commitment, and chain authorization
checks precede the signature pass; a proof with multiple defects reports the
first of those structural/authorization failures. A structurally valid proof
with a forged signature still reports `signature_mismatch`. These local digests
are never accepted from a server and are not protocol checkpoints. Full
evidence loading, hashing, reconstruction, and authorization checks remain
proportional to history; reads are not constant-time and cold responses are
not bounded in size.

An API/SDK regression advances a policy through 32 successors and checks that a
repeat fetch, and a fetch after one more successor, omit the cited bundles,
return fewer bytes than the cold response, and yield the same verified
evidence. Further regressions cover actual container rotations, document links,
deleted groups, forged successors, omissions a request never cited, damaged and
evicted rows, and cold devices without a table. A signature-call probe verifies
64 entries once, reuses all 64 on a repeat pass, and makes only 64 further
calls when extended to 128.

The API memoizes parsed directory bindings by the immutable stored organization
head and the requested group set, so a successor head misses that cache. It is
a least-recently-used cache with a 32 MiB budget of estimated retained bytes,
charging serialized values conservatively plus entry overhead, and it returns
isolated copies to callers. It avoids repeating directory history reads and
parsing for each projection at a stable head. The budget bounds retention; it
does not bound cold verification work or eliminate misses for larger working
sets.

The API load regression seeds 64 additional signed groups (66 directory
entries) and measures 64 and 128 signed directory successors through real API
reads and cold SDK key recovery. It requires only one directory payload, only
the cited Admins source, successful recovery, a 40 kB projection limit and less
than five percent projection growth when history doubles. Signed principal
history travels through separate pages. Wall-clock timings are diagnostic, to
avoid machine-dependent CI failures; delivery sizes are recorded in the test
output.

## Principal history length

Principal versions have no lifetime history budget. They are positive exact
JavaScript integers through `Number.MAX_SAFE_INTEGER`; PostgreSQL stores them
as `bigint` and SQLite as `INTEGER`, with matching range checks on state and
manifest-head projection columns. Overflow is rejected before hashing or
signing. Policy-history artifact reads load membership and grants in batches of
100 states (`PRINCIPAL_HISTORY_BATCH_SIZE`). Bulk current-head reads select the
maximum version per principal in SQL and transfer only those rows, rather than
fetching all historical signatures to choose heads in memory.

The opt-in command `bun run --cwd packages/api test:principal-history` builds
complete signed group and organization histories through 16,384 versions,
commits a membership revocation and key rotation past them, and cold-recovers
an older encrypted document after losing verification markers and all local
SDK state. It runs on both database backends sequentially, through the
production Bun binding and the real API client. The default API suite runs the
same scenario at 64 versions, alongside the exact numeric-boundary crypto and
storage tests. The full test clears durable/process manifest markers, signature
caches, stored policy/snapshot results, and directory bindings. Run it before
changes to history traversal, version bounds, signature caching, or cold
recovery transport.

Bun's socket-idle timer also counts time spent computing a response without
sending bytes. Authentication creates a request-local capability to opt out of
that timer; the shared principal-policy workflows invoke it when they begin
loading or verifying history. This covers indirect authorization reads as well
as policy commits, without depending on a route allowlist. Requests that never
reach policy verification keep the default deadline. The Bun listener is
loopback-only in development; the deployed Worker enforces the request-body
ceiling itself and imposes no idle response timeout. Both deployment tiers
serve the API through Cloudflare. Cloudflare's
[documented default proxy read timeout](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)
is 125 seconds; opting out of Bun's idle timer does not remove that external
deadline. Live Cloudflare plan overrides are not established by this
repository.

Cold recovery therefore pages its work, using authenticated durable progress
and preparation scheduling, and verifies the entire signed history without
introducing trusted server heads. Continuation covers server-side mutation
authorization as well as response delivery: paging a response cannot repair a
mutation that exceeds the proxy budget before sending headers. Each
continuation preserves signature, signer-authorization, continuity,
key-rotation, rollback, and equivocation checks. The
[isolated HTTP acceptance scenario](principal-history-acceptance.md) enforces a
15-second deadline per response on SQLite and networked PostgreSQL. The
[principal-history model](../formal/container-keying/PrincipalHistory.md)
checks revocation and cold recovery availability with negative controls for
both kinds of cutoff. Neither the model nor the numeric domain promises bounded
cold memory, transfer size, or verification time.
