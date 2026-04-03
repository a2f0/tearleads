# Container Access Efficiency

This note documents the runtime characteristics of
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

The current runtime is:

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

The current implementation removes that nested-loop expansion from TypeScript by
delegating recipient expansion to SQL joins in `loadGrantedRecipients(...)`.
That changes the application-side expansion step from repeated grant-to-
membership scans to a single pass over the returned recipient rows.

So the key improvement is:

- before: `O(G * M)` application-side expansion
- now: `O(R)` application-side processing after SQL expansion

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
