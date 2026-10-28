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
  `src/Tearleads.ts`, `src/client/deviceFirst/`, and the workflow runtime
  in `src/client/runtime/workflowRuntime.ts`.
- **Scoped singleton**: one object per database or per domain scope, returned
  by a `getOrCreate…(scope)` function backed by a module-private `WeakMap`.

## Seams

| Seam | Port or singleton | Production adapter | Other implementations |
| --- | --- | --- | --- |
| Reconciliation timers and lanes | `ReconciliationHost` (`clock`, `registerLane`) | `systemReconciliationClock`, the domain sync coordinator | Manual clock in tests |
| Principal policy history | `PrincipalPolicyHistoryReader` (`historyReader`) | The API client, via `apiPrincipalPolicyPageReader` | Registration's provisioned bundles; directory discovery's page replay |
| Current principal policy | `CurrentPrincipalPolicyReader` (`currentPolicyReader`) | The API client, as is | `directoryPinnedPolicyReader` for the group-name authority check |
| Principal policy process state | `getOrCreatePrincipalPolicyCoordinator(execSql)` | One coordinator per database | None |
| Acknowledged principal currents | `PrincipalAcknowledgementChecks`, the host for `recordAcknowledgedPrincipalCurrents` | The organization mutation checks bound by `retainAcknowledgedPrincipalCurrents` | None |
| Domain sync lanes | `getOrCreateDomainSyncCoordinator(domainScope)` | One coordinator per domain scope | None |
| Identity change preparation | `IdentityChangePreparation` | `Blobs` prepares a store and returns a commit that only assigns state | No-op preparation in identity/session tests |

## Where code goes

`data/`, `workflows/`, and `client/` hold folders, not loose modules, and each
folder maps to a subsystem in `scripts/architecture/subsystems.ts` or names one
shared role.

In `data/`, the root holds only its README; `bun run lint:files` rejects any
other file there.

- Domain folders (`blobs/`, `containers/`, `documents/`, `principals/`,
  `sync/`, `trustedUserIdentity/`) hold that domain's contracts and helpers.
- `keyingProjectionVerification/` is entered through its `index.ts` facade;
  `keying/` holds the keying primitives it shares with persistence and
  workflows.
- `shared/` holds only contracts and helpers every layer uses with no
  subsystem of their own: `DomainScope`, the `SecurityIncidentReporter` port,
  `errorMessage`, record readers, and User Timing marks. A helper one
  subsystem uses goes in that subsystem's folder instead.
- `blobs/`, `persistence/`, `sqlite/`, and `sync/` are internal to stores. A
  store reaches a module there through the matching workflow facade, such as
  `workflows/blobs` or `workflows/sync`.

In `workflows/`, the root holds only its README. Each folder is a workflow
facade except `shared/`, which holds the runtime input contract that the
per-domain workflow runtimes build on.

In `client/`, the root holds only the `index.ts` facade barrel; `bun run
lint:files` rejects any other file there.

- Each `tearleads.*` facade with its own subsystem has a folder whose
  `index.ts` is the facade: `blobs/`, `containerContents/`, `deviceFirst/`,
  `documents/`, `identity/`, `organizations/`, `root/`, `securityIncidents/`,
  and `session/`. Helpers that only one facade uses sit beside it.
- `runtime/` holds live client state (`Database`, `Events`, `Network`,
  `ApiVersion`, `SyncBillingGate`) and the workflow runtime with the adapters
  the composition root builds for it, such as principal history custody and
  principal mutation dispatch.
- `host/` holds contracts the embedding app implements, such as `Logger` and
  `FileSaver`, when no single facade owns them. Its README lists them.
- `billing/` and `localKeyring/` hold the purchase and local keyring
  adapters.

Inside a large folder, each feature gets a subfolder:

- A facade file beside a folder of the same name becomes that folder's
  `index.ts`, so import paths keep working.
- About four or more production files built around one behavior become a
  subfolder named for it, and a file named like that subfolder becomes its
  `index.ts`. Tests and fixtures move with their subjects.
- Other file names stay as they are, so searches keep finding them and no
  folder grows a set of ambiguous `types.ts` files.
- The folder root keeps its facade, its runtime, and the helpers several
  features share. An ls-lint budget pins the root's file count, so a new
  module goes into a feature folder or raises the budget on purpose. Aim for
  about 40 files directly in any folder.

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

A host interface also keeps dependencies pointing down when a lower component
needs a decision only an upper one can make. Recovery records acknowledged
principal currents, but only the organization workflows that authored a
mutation can check its receipt, so they pass those checks in as
`PrincipalAcknowledgementChecks` rather than recovery importing them.

State that a lower layer also writes lives in a neutral lower module, reached
by upper layers through a `workflows/*` facade. The originated-documents
registry lives in `data/sync/` for this reason.

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

## Subsystem surfaces

Each subsystem in `scripts/architecture/clientSdkSubsystems.ts` declares a
`surface`, listed in `clientSdkSurfaces.ts`: the files other subsystems may
import. It holds the subsystem's facade indexes, the contract modules it means
to share, such as types, errors, document kinds, and its main persistence
module, and the capabilities other subsystems build on, such as keying
checkpoint persistence or admin-signer verification. SQLite Runtime and SDK
Shared Utilities declare none, so any of their files may be imported.

`bun run lint:architecture` fails when an import enters another subsystem
outside its surface, type-only imports included. Tolerated deep imports are
listed by target file in `scripts/architecture/subsystemSurfaceBaseline.json`.
The check also fails on an entry whose import is gone, so the list only
shrinks.

- When you change code that imports through the baseline, import from the
  surface instead, or export the symbol from a facade, and delete the entry.
- Add a module to a surface only when it is a deliberate contract. Never add a
  baseline entry to land new code.
- When you move a file the baseline names, rename its entries.

### Table ownership

Each SQLite table belongs to one subsystem, listed by its `sqliteTable` export
name in the subsystem's `tables` (`scripts/architecture/clientSdkTables.ts`).
Only the owner writes a table. Others read only the tables the owner lists in
`readableTables`, the way a surface exposes files; Document Store, for example,
exposes the document tables Container Contents' read model joins on. Anything
else goes through the owner's surface.

`bun run lint:architecture` type-checks each package that declares tables and
resolves every reference with the compiler's own symbols, so imports, re-exports
(cycles included), aliases, scopes, destructuring, `import()`, and object
properties resolve as they do at runtime. A re-export is not itself a use: each
table is checked where it is read or written. A file reaches a table by:

- naming it, directly or through any of those;
- reading it off a schema module namespace, a schema object such as
  `clientSQLiteSchema`, or Drizzle's `db.query`, including an alias or a
  destructured key of `db.query`;
- naming it in raw SQL in a string or template.

`db.query` serves each table under its export name, as a schema module
namespace keys it, and under every key of an exported schema object or of
whatever reaches `drizzle`'s `schema` option. A key two schemas share reads
every table either serves under it.

A column reference, destructured columns, `.from(...)`, a join, `typeof`,
`db.query`, and SQL `FROM`/`JOIN` read a table; `insert`, `update`, `delete`,
and SQL `INSERT`, `UPDATE`, and `DELETE` write it. Any other use, such as
passing the table to a helper or listing it for a loop, counts as a write, so an
indirect write cannot pass as a read. A schema value used where its tables
cannot be told apart, such as `Object.values(clientSQLiteSchema)`, a spread, or
a computed index or destructuring key, counts as writing every table it holds;
`db.query` passed along that way counts as reading every table it serves, or
every table when its type is `any` or `unknown`. Schema modules are exempt, and
so is the schema SQLite Runtime passes to `drizzle`, whose `db.query` reads are
checked where they happen. The surface check sees none of this: schema imports
land in SQLite Runtime, which declares no surface, and raw SQL imports nothing.
Tolerated uses are listed by table in
`scripts/architecture/subsystemTableBaseline.json`, which only shrinks like the
surface baseline.

## Enforcing a boundary

Client SDK dependency rules live in
`scripts/architecture/dependencyCruiserClientSdkRules.ts`. An extracted
component gets:

- a declared entry: other code imports the component's `index.ts`, not its
  internals. A whole subsystem gets this from its surface; a component inside
  one, such as `sync/reconciliation`, gets its own rule. When the entry is a
  public workflow facade, list the modules the rest of the SDK may import in
  the surface instead, as `workflows/principals` does, rather than adding
  internal exports to the facade;
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
- Moving files means searching scripts, docs, and `formal/` for every old
  path, tests included. Protocol projection scripts such as
  `scripts/protocol/checkRestartProbeProjection.ts` run scenario tests by path.
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
