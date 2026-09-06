# Protocol Models

This directory contains executable abstractions of protocol safety rules. The
models complement the runtime grammar in
[`docs/protocol-specification.md`](../docs/protocol-specification.md); they do
not replace Zod validation, cryptographic verification, database constraints,
or integration tests.

Run every bounded model with:

```sh
mise install java github:tlaplus/tlaplus
bun run check:protocol-models
```

The repository pins Java 21 and the prebuilt TLA+ tools; TLC itself requires
Java 11 or newer. No generated state directory or tool binary is committed.

[`protocol-models.txt`](./protocol-models.txt) is the pull-request model
registry. Each non-comment line pairs one repository-relative TLA+ module and
configuration as `model|config`. The checker validates the complete registry
before starting Java, rejects unregistered configuration files, sorts pairs
deterministically, and gives each TLC invocation an isolated state directory.

Model documentation that maps abstract actions to production seams does so in
`Model action … | Production …` tables; the registry in
`scripts/lintFormalAbstractionMaps.ts` pins which documents carry them.
`bun run lint:formal-maps` (part of `check:fast`) verifies every backticked
model token is declared in the module the table documents and every backticked
production seam occurs in production package source code, so a rename or
removal on either side fails the check instead of leaving the map prose-only.
`ContainerGrantScope` and `KeyringReachability` document their seams in prose
and carry no map tables; `NoBrickedDevice` carries one.

The bridge also runs in the implementation-to-model direction:
`bun run check:protocol-projection` (part of `check:fast`) records
fault-injected runs of the real probe and interest seams and replays them as
action sequences through `RestartProbeConvergence` with TLC, failing on any
trace the model rejects. See the
[trace projection section](./document-sync/RestartProbeConvergence.md) for the
recorded scenarios, negative controls, and boundaries.

`bun run check:protocol-negative-controls` (part of `check:fast`) proves the
invariants are not vacuous: each entry in `scripts/protocolNegativeControls.ts`
flips one rule or lock in a registered configuration and requires TLC to
report exactly the named violation. `bun run check:no-brick-projection` (also
in `check:fast`) replays recorded runs of the real container-path and
principal-policy verifiers through `NoBrickedDevice` the way the restart-probe
projection does; see the [trace projection section](./container-keying/NoBrickedDevice.md).

To add a model, commit its `.tla` and bounded `.cfg` files and register the pair.
One module may appear with multiple configurations, but each configuration must
appear exactly once. Keep registered bounds small enough for `check:fast`;
broader configurations should use a separate scheduled suite rather than
silently increasing pull-request check time.

## Container Grant Scope

[`container-keying/ContainerGrantScope.tla`](./container-keying/ContainerGrantScope.tla)
models the accepted container-grant domain. TLC checks that every reachable
grant names either a group in the container's organization or an active direct
user in that organization; an organization principal is never a container
grant subject. It also models roster removal as a guarded transition: a user
must first be unshared from every directly granted container, whose revoke is a
container KEK rotation in the runtime and in the keyring model below.

The production seams are the container grant grammar, the locked group/user
reference checks in `groupReferences.ts`, and the direct-grant blocker in
`roster.ts`. The bounded configuration includes same- and foreign-organization
users, groups, and organization principals so TLC explores every accepted
grant/revoke and roster transition over those categories.

## Container Keyring Reachability

[`container-keying/KeyringReachability.tla`](./container-keying/KeyringReachability.tla)
models cold recovery from persisted user/group recipient wraps, immutable
predecessor bridges, and sealed historical keyrings. Its `Members` abstraction
is the set of users authorized by active direct-user or same-organization group
grants; organization principals are not recovery recipients.

## No Bricked Device

[`container-keying/NoBrickedDevice.tla`](./container-keying/NoBrickedDevice.tla)
models the invariant that no device may ever be unable to read or write
because another device holds a cache or must issue a write first. A dependent
(descendant container, or group policy) cites an authority (ancestor, or
Admins policy); every client refusal rule is a parameter, and the currency
rules withdrawn in #2174 and #2173 are the negative controls that reproduce
the bricking. See the [mapping, configurations, and boundary](./container-keying/NoBrickedDevice.md).

## Document Baseline Dominance

[`document-sync/BaselineDominance.tla`](./document-sync/BaselineDominance.tla)
models the no-data-loss gate for document sync baseline redirection: a
normal-mode read may omit an older-epoch update only when a readable
current-epoch baseline provably dominates it, and raw mode always serves the
complete retained missing frontier. Because the invariants share the
`Dominated`/`Older` operators with the serve action, TLC alone cannot check the
dominance definition itself; the registered
[`BaselineDominanceTraceExport.tla`](./document-sync/BaselineDominanceTraceExport.tla)
closes that blind spot by exporting every served behavior into the committed
fixture
[`BaselineDominanceTraces.json`](./document-sync/BaselineDominanceTraces.json)
(`bun run generate:protocol-traces`, drift-checked by
`bun run check:protocol-traces`), which the TypeScript replay suite drives
through the real dominance/redirect kernels and an independent
componentwise-counter oracle on every push. See the
[production mapping, trace bridge, bounds, and assumptions](./document-sync/BaselineDominance.md).

## Deferred Document-Tail Settlement

[`document-sync/DeferredTailSettlement.tla`](./document-sync/DeferredTailSettlement.tla)
models the device-first outgoing-delta marker across local edits, durable
queue writes, restarts, sync preparation, server acceptance, incoming updates,
reset/reinitialize, relink, and deletion, and requires that persisted coverage
never outruns accepted or durably queued work and that a stale completion can
never publish into a replacement generation. See the
[production mapping, explored orderings, invariants, and bounds](./document-sync/DeferredTailSettlement.md).

## Opened-Document Recovery Probes

[`document-sync/RestartProbeConvergence.tla`](./document-sync/RestartProbeConvergence.tla)
models startup and acknowledged-reconnect probes, peer writes during the
handshake or an in-flight pull, and signal-sequence coalescing for encrypted Loro
body and attachment-slot state. Its bounded run explores 6,757 generated states,
1,912 distinct states, and depth 15. See the
[production mapping and model boundary](./document-sync/RestartProbeConvergence.md)
for the action seams, fairness assumptions, and excluded blob-hydration layer.

## Empty-Frontier Baseline-less Unlink

[`document-sync/EmptyFrontierUnlink.tla`](./document-sync/EmptyFrontierUnlink.tla)
models the acceptance gate for a document unlink submitted without a rotation
baseline. An unlink rotates the document content key, so a committed update no
accepted baseline covers becomes unreadable under the new epoch. A document
with an empty committed frontier cannot produce a baseline at all — a
zero-span full-history snapshot encodes no replayable history — so the server
accepts a baseline-less unlink only after proving the committed frontier is
empty inside the mutation transaction, under the document manifest-head write
lock that sync writers also take exclusively.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `BeginBaselinelessUnlink` / `CommitBaselinelessUnlink` | `assertBaselinelessUnlinkHasEmptyCommittedFrontier` inside `mutateDocumentLinkSetWithExecutor` |
| `CommitCoveringUnlink` | `assertAtomicRotationBaselineCoversCommittedFrontier` + `appendAtomicRotationBaseline` |
| `WriterMayCommit` | the exclusive manifest-head locks in `lockDocumentLinkSetMutationFrontier` and `lockSyncDocumentWriteFrontier` |
| the client never sending an empty baseline (boundary assumption) | `buildDocumentRotationBaseline` returning null for a zero-span snapshot |

The checked configuration sets `LockedUnlink = TRUE`, matching production, and
the invariants require that no rotation ever orphans an uncovered committed
update and that the emptiness observation stays true through the commit
window. Setting `LockedUnlink = FALSE` (a writer allowed to commit between the
emptiness proof and the unlink commit) makes TLC report the `NoDataLoss`
violation immediately — the lock discipline is load-bearing, not incidental.
The negative-control check asserts this on every run.
The bounds stay small (`MaxUpdates = 3`); the state space is tiny because the
model tracks only the uncovered-update count and the unlink transaction phase.
