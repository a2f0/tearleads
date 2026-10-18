# Client SDK seams

How components inside `packages/client-sdk` meet, so each can be read, tested,
and changed on its own. Apply these patterns when adding a collaborator to a
component, extracting a component, or touching an existing seam. The
`isolate-sdk-component` skill is the step-by-step workflow; this page is the
reference it follows.

## Vocabulary

- **Port**: an interface named for what a component needs (`…Reader`,
  `…Clock`, `registerLane`), not for who provides it.
- **Adapter**: the object that satisfies a port. Often an existing object
  already does, as the API client does for the principal-policy readers.
- **Host interface**: the set of ports one component receives from its caller,
  such as `ReconciliationHost`.
- **Composition root**: where production adapters are wired to ports:
  `src/Tearleads.ts`, `src/client/deviceFirst.ts`, and the workflow runtime
  in `src/client/workflowRuntime.ts`.
- **Scoped singleton**: one object per database or per domain scope, returned
  by a `getOrCreate…(scope)` function backed by a module-private `WeakMap`.

## Current seams

| Seam | Port or singleton | Production adapter | Other implementations |
| --- | --- | --- | --- |
| Reconciliation timers and lanes | `ReconciliationHost` (`clock`, `registerLane`) | `systemReconciliationClock`, the domain sync coordinator | Manual clock in tests |
| Principal policy history | `PrincipalPolicyHistoryReader` (`historyReader`) | The API client, via `apiPrincipalPolicyPageReader` | Registration's provisioned bundles; directory discovery's page replay |
| Current principal policy | `CurrentPrincipalPolicyReader` (`currentPolicyReader`) | The API client, as is | `directoryPinnedPolicyReader` for the group-name authority check |
| Principal policy process state | `getOrCreatePrincipalPolicyCoordinator(execSql)` | One coordinator per database | None |
| Domain sync lanes | `getOrCreateDomainSyncCoordinator(domainScope)` | One coordinator per domain scope | None |

## Ports and adapters

Name the port for the capability and the field for the role:
`historyReader: PrincipalPolicyPageReader`, not `apiClient`. Keep the name
`apiClient` only where the value really is a slice of the API client, such as
one that also recovers pending mutations.

Let the existing object be the adapter when its methods already match.
Callers then pass the object (`currentPolicyReader: input.apiClient`) rather
than a lambda or a `.bind` around one of its methods. A method called on the
object keeps its `this`; a detached method does not, and the rewrap hides that.
When the API client may lack a method (`Partial<…>` runtimes), a small
`api…Reader(apiClient)` function returns the port or `undefined`.

Declare the signature once, in the port, and have API slices extend it. Ten
copies of one signature drift independently; one port changes in one place.

A port changes where data comes from, never what is verified. Every page or
bundle a reader returns is untrusted input to the same verifier, whichever
adapter supplied it. Say so in the port's doc comment.

## When not to add a port

Add a port only for a collaborator that has, or a test genuinely needs, a
second implementation. Registration replays provisioned bundles and the
directory check serves pinned heads, so the readers earn their ports.

Do not wrap single-implementation code in an interface. Principal-policy
persistence spans about thirteen modules with one SQLite implementation, and
tests already run against in-memory SQLite; a store port there would add
indirection without a second adapter.

Do not replace a fake that exercises trust-boundary code. Tests that serve
policy pages from a `Bun.serve` fake run the real API client iterator, which
checks head pinning, ordering, cursors, and resume. An in-memory reader would
skip those checks.

Do not merge look-alike code on verifier paths when the call sites differ. Four
workflows read "the retained bundle at this head, else the current one", but
one needs to know where the bundle came from, one hard-codes the group type,
and one reads the cache only when it has a head. A shared helper would hide
those differences.

## Host interfaces and the composition root

A component receives runtime collaborators (timers, lane registration, the
clock) through its host interface. It never imports the module that provides
them. The composition root constructs the real ones; tests pass fakes such as a
manual clock that steps timers deterministically.

State that a lower layer also writes moves to a neutral lower module, reached
by upper layers through a `workflows/*` facade. The originated-documents
registry moved to `data/sync/` for this reason.

## Scoped singletons

Process-local state that belongs to one database or one domain scope lives in
a single object from `getOrCreate<Name>(scope)`:

```ts
const coordinators = new WeakMap<ExecSql, PrincipalPolicyCoordinator>();

export function getOrCreatePrincipalPolicyCoordinator(execSql: ExecSql) {
  const database = resolveCanonicalExecSql(execSql);
  let coordinator = coordinators.get(database);
  if (!coordinator) {
    coordinator = createPrincipalPolicyCoordinator();
    coordinators.set(database, coordinator);
  }
  return coordinator;
}
```

- Key per-database state by `resolveCanonicalExecSql(execSql)`, so a
  transaction's locked executor reaches the same object as the client's
  executor. Key per-scope state by `DomainScope`.
- Group state that shares a scope and a subject into one object rather than
  one `WeakMap` per concern. Callers then read
  `getOrCreatePrincipalPolicyCoordinator(execSql).queueRecovery(…)`, and a
  reader finds every piece of that state in one file.
- Never hold this state in a plain module-level `Map` or a process-global
  singleton. Tests isolate by creating a new database or scope, which gets a
  fresh object; nothing needs resetting between tests.
- Share primitives inside the singleton, such as one keyed queue for both the
  recovery queue and the journal lane.
- Document re-entrancy. Work queued on a keyed queue must not queue again on
  the same key, or it waits on itself.

When the grouped state is a behavior with its own collaborators, the singleton
becomes a service: one entry point that composes the ports and the per-scope
state, replacing option bags that thread the same collaborators through every
call.

## Enforcing a boundary

Client SDK dependency rules live in
`scripts/architecture/dependencyCruiserClientSdkRules.ts`. An extracted
component gets:

- an index-only entry: other code imports the component's `index.ts`, not its
  internals;
- no runtime imports of upper layers, with type-only imports allowed through
  `dependencyTypesNot: ["type-only"]`;
- its place in the tier order data → workflows → stores → sync → client.

Probe each new rule with a temporary violating import before relying on it.

## Making the change

- Ship one seam per pull request. Name the port in one change, move state into
  a singleton in another, and compose them in a third.
- Let the compiler drive renames, then rebuild the SDK
  (`bun run --filter='@tearleads/client-sdk' build`) and typecheck each
  dependent package directly with
  `bunx tsc -p packages/<name>/tsconfig.json --noEmit`. An incremental
  `tsc --build` can report success while a dependent still uses the old shape.
- A renamed option on an exported function is a public API change even when no
  export name changes. Call it out in the pull request.
- Formal abstraction maps under `formal/` name production seams, and
  `bun run lint:formal-maps` fails when a named function disappears. Update the
  map in the same change.
- When a refactor changes behavior, even only the keying, add a test that fails
  under the old behavior and confirm it fails before relying on it.

## Tests behind ports

- Fakes implement the port, so a test needs no HTTP server unless it is testing
  the trust boundary itself.
- A shared test helper may accept plain fake functions and adapt them to ports
  itself, as `cacheReferencedPolicies` does with `getCurrentPrincipalPolicy`
  and `getUserIdentity`. Tests that go through it do not change when a port
  does.
- Expensive signed fixtures are built once per test process and copied per
  caller with `structuredClone`. The copy drops symbol-keyed brands such as the
  trusted-identity brand, so rebuild those from the copied data.
