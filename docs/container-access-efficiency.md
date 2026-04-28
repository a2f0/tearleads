# Container Access Efficiency

This document describes the runtime characteristics of
`packages/api/src/access/containerAccess.ts`, especially the recipient
expansion path discussed in PR review feedback.

## Scope

The relevant flow is:

1. `resolveContainerAccessState(containerId)`
2. `resolveContainerRecipients(containerId)`
3. `listAncestorContainerIds(containerId)`
4. `loadContainerGrantRows(ancestorContainerIds)`
5. `loadGrantedRecipients(ancestorContainerIds)`

## Runtime Summary

Let:

- `A` = number of ancestor containers on the path from root to the target
  container
- `G` = number of grants across those ancestor containers
- `R` = number of recipient rows produced after expanding user, organization,
  and group grants into users
- `U` = number of distinct effective users after access-level merging

The API-layer runtime is:

- ancestor discovery: `O(A)`
- grant row loading: `O(G)` application-side after the query returns
- recipient expansion: `O(R)` application-side after the query returns
- access-level merge into maps: `O(R)`
- user id canonicalization via `uniqueSortedStrings(...)`: `O(U log U)`
- fingerprint derivation for each effective recipient: `O(U)` async work, plus
  the cost of `toFingerprint(...)` per recipient
- final recipient sort by key fingerprint: `O(U log U)`

Ignoring database execution details and the per-recipient cryptographic cost,
the application-side runtime is:

`O(A + G + R + U log U)`

In practice, the dominant terms are usually:

- SQL expansion of grants into recipients
- per-recipient fingerprint generation
- final sort of the effective recipient set

## Why This Is Better Than The Earlier Version

The earlier implementation loaded grants and membership rows separately, then
expanded organization and group grants with nested loops in application code.
That produced an `O(G * M)` scan in the worst case, where `M` was the number of
membership rows under consideration.

The implementation removes that nested-loop expansion from TypeScript by
delegating recipient expansion to SQL joins in `loadGrantedRecipients(...)`.
That changes the application-side expansion step from repeated grant-to-
membership scans to a single pass over the returned recipient rows.

So the key improvement is:

- before: `O(G * M)` application-side expansion
- after SQL expansion: `O(R)` application-side processing

This does not mean the database work is free. It means the expensive
grant-to-membership cross-product is no longer implemented as explicit nested
loops in the API layer.

## Notes And Limits

- `listAncestorContainerIds(...)` uses a recursive CTE and caps traversal depth
  at 100 to prevent runaway recursion.
- `loadGrantedRecipients(...)` can return duplicate user rows when a user
  matches multiple grants. Those duplicates are merged in `effectiveAccessByUserId`.
- The runtime for `loadGrantedRecipients(...)` at the database level depends on
  indexes, join cardinality, and Postgres query planning, so this doc only
  states the API-layer asymptotics.
- The final sort is intentional because recipient ordering must be stable for
  downstream fingerprint computation and envelope materialization.

## Practical Scaling Assessment

The asymptotic summary above is useful, but it does not fully describe where the
system will get expensive in production.

The main improvement is that the API process no
longer performs explicit `grant x membership` nested loops. That is a meaningful
win.

However, the design still has a large fanout surface:

- `loadGrantedRecipients(...)` materializes one SQL row per expanded recipient
  match
- users who match multiple grants can appear multiple times before the
  application-side merge
- each row carries both `encapsulation_public_key` and
  `encapsulation_key_fingerprint`
- the full expanded recipient set crosses the DB boundary on each access
  resolution

That means the real bottleneck is no longer TypeScript loop complexity. It is:

- SQL-side grant expansion cost
- result-set size crossing the DB boundary
- repeated recomputation of the same recipient sets in higher layers

This document describes `containerAccess.ts` in isolation. The
full access plane compounds this work:

- document access resolves linked container access states
- blob access resolves linked document access states
- attachment commits can refresh many blobs in one transaction

So the practical cost is often closer to:

- resolve container recipients once
- then re-read and re-merge those results again while deriving document access
- then re-read and re-merge them again while deriving blob access

This approach scales adequately for:

- personal and small-team usage
- small organizations
- moderate recipient sets where effective users are in the tens or low
  thousands

This approach is likely to become uncomfortable for:

- organization-wide shares in large orgs
- containers with many overlapping org and group grants
- workloads that mutate many attachments in one transaction
- hot objects whose access is recomputed repeatedly in a short time window

This approach is likely to become a redesign target for:

- effective recipient sets consistently in the many-thousands to tens-of-
  thousands range
- high write churn on documents and blobs sharing the same upstream container
  policy
- environments where low-latency access recomputation matters as much as
  correctness

Deep trees are not the first concern here. Ancestor traversal is linear in path
length and capped. Recipient expansion fanout is the real scaling limit.

## Next Design

If the goal is to keep the current semantics but raise the scaling ceiling, the
next design should focus on eliminating repeated expansion work, not merely
micro-optimizing the current loops.

### 1. Treat container recipient expansion as a materialized access primitive

Instead of recomputing the effective recipient set from raw grants on every
resolution, introduce durable container-level effective access state, for
example:

- `container_effective_recipients(container_id, user_id, access_level,
  key_fingerprint, policy_version)`

Then:

- grant or membership changes update the materialized rows for affected
  containers
- reads consume the already-expanded recipient set directly
- document and blob access derivation can reuse that stable container-level
  result

This shifts work from repeated read-time expansion toward targeted write-time
maintenance.

### 2. Make document and blob access depend on upstream fingerprints first

The document and blob layers resolve and merge full recipient lists.
That is expensive.

A better shape is:

- container access owns recipient expansion
- document access primarily tracks linked container ids and linked container
  access fingerprints
- blob access primarily tracks linked document ids and linked document access
  fingerprints

Then:

- if upstream fingerprints are unchanged, downstream recomputation can be
  skipped
- downstream layers only expand recipients when they actually need to
  materialize V2 key-target envelopes

### 3. Batch recomputation by transaction scope

For attachment-heavy writes, avoid recomputing the same container or document
state repeatedly inside a single transaction.

Add transaction-scoped caches for:

- container access state by container id
- document access state by document id
- current epoch rows by object id

This is a tactical optimization, but it materially reduces redundant work on
hot commit paths.

### 4. Push duplicate elimination closer to SQL if fanout grows

If large recipient sets become common, reduce result-set volume before rows
reach the API process.

That could mean:

- grouping by `user_id` in SQL
- computing max access rank in SQL
- returning one row per effective user rather than one row per matching grant

This still does not solve repeated recomputation across layers, but it lowers
DB-to-app transfer volume.

## Architectural Framing

This belongs to the access plane.

More specifically:

- container, document, and blob access resolution are core access-plane logic
- epoch and fingerprint propagation are access-plane invalidation mechanics
- recipient envelope rewriting is where the access plane meets the key-
  distribution / cryptographic-delivery plane

So this is slightly broader than pure authorization.

It is best thought of as:

- an access-control plane
- plus access-state propagation
- plus recipient key-delivery materialization

That broader framing matters because scaling constraints come from all three,
not just permission checks.
