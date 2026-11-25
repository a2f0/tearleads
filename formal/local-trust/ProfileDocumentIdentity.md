# Profile document identity and discovered-row reuse

[`ProfileDocumentIdentity.tla`](./ProfileDocumentIdentity.tla) models the
identity-selection seam shared by roster and organization profile creation.
An existing materialized profile must reopen through its actual persisted local
ID, not attempt another birth at the preferred creation-local ID. This is not
an alias merge or a new permission to adopt arbitrary remote documents.

## State and orderings

The bound is one request, two local IDs, three nonempty remote identities, and
one scope-generation change. Initial scenarios cover a fresh birth, a
previously discovered alias, preferred records with current or recovery
identity, a recovery-only alias, an explicit profile pointer with an unrelated
record occupying the preferred ID, an unavailable explicit pointer, and a
birth racing one discovery. Current identity outranks recovery identity,
which outranks planned derivation. A known pointer outranks the unrelated
preferred record; an editor's explicit open cannot create a missing target.

Pointer scenarios represent editor opens, not the creation factory. The
resolver may classify an absent record as creatable; the editor must reject
that classification. `FinishLookup` includes this caller decision. The
creation factory's fresh path has no explicit pointer in this bound.

The racing scenario has separate lookup-start and lookup-completion actions.
Discovery may materialize the alias before the lookup, after a captured miss,
or after birth. The birth transaction checks again: a late alias refuses a
second birth, while discovery following birth uses the existing local row.
No discovery or open action merges histories or replaces retained content.
The payload token stands for names, addresses, unknown rows, and other existing
content; it is opaque, not a model of Loro operations or CRDT convergence.

Scope expiry may occur between any local steps. Lookup completion, opening,
birth, and open completion must still belong to the captured request. All
reads and opens are assumed to use the workflow runtime captured at entry;
the model does not simulate a mutable SDK facade or a second database. Runtime
capture and caller-generation wiring still need implementation regressions.

## Production mapping

The app seam is
[`profileDocumentIdentity.ts`](../../packages/app/src/stores/org-manager/profileDocumentIdentity.ts),
used by the factories in
[`profileDocuments.ts`](../../packages/app/src/stores/org-manager/profileDocuments.ts).
The editors resolve and admit existing targets through
[`profileDocumentBinding.ts`](../../packages/app/src/mini-apps/org-manager/profile/profileDocumentBinding.ts),
with request-tagged completion in
[`profileDocumentRequestMachine.ts`](../../packages/app/src/mini-apps/org-manager/profile/profileDocumentRequestMachine.ts).
Recovery candidates come from the narrow metadata query in
[`documentIdentityCandidates.ts`](../../packages/app/src/stores/documents/documentIdentityCandidates.ts),
not a full-record read for every document in the profile container.
The birth transaction is
[`createDocumentWithHistoryCheckpoint.ts`](../../packages/client-sdk/src/data/persistence/documents/internal/createDocumentWithHistoryCheckpoint.ts).

| Model action or predicate | Production seam |
| --- | --- |
| `FinishPreferredRead`, `ResolvedIdentity` | `resolveProfileDocumentIdentity` choosing a known pointer or persisted identity before `deriveStableDocumentId` |
| `BeginLookup`, `FinishLookup` | `defaultDocumentsPersistence.findLocalIdByDocumentId`, then container-scoped recovery candidates from `loadDocumentIdentityCandidates`, with `recordIdentity` validation; `resolveProfileDocumentIdentity` uses the captured runtime and checks currency after awaits |
| `OpenExisting`, `FinishOpen` | `createRosterProfileDocument` and `createOrganizationProfileDocument` reopening through `Documents.open` and `ensureInitialized`, without applying creation seeds to an existing row |
| `ExplicitPointerNeverCreates` | `RosterProfileEditor` and `OrganizationProfileEditor` use `useProfileDocumentBinding`; `resolveBinding` accepts only an existing identity before mounting `DocumentsProvider` |
| `AttemptBirth` | `createStoredDocumentWithHistoryCheckpoint` and `classifyExistingBirth` refusing a remote-alias birth under `runSerializedSqlMutation`; concurrent same-local winner restoration is outside this bound |
| `Discover` | `upsertDiscoveredDocumentWithExec`, `nextDiscoveredDocument`, and `loadPendingCreateSummary` retaining the existing local row or deferring a pending birth |
| `ExpireScope`, `AbortStale` | caller generation or runtime expiry observed through `stillCurrent`; `transitionProfileDocumentRequest` rejects obsolete completions and `useProfileDocumentBinding` masks obsolete results during render |
| Runtime capture (boundary assumption) | `Documents.workflowRuntime` and the `workflowRuntime` option on `Documents.open` pin the database used throughout the request |

The birth transaction only probes current remote bindings, not recovery-only
aliases. Recovery aliases are found by the app's identity resolver before
birth. The model's discovery action abstracts a materialized result; it does
not skip the SDK's pending-create adoption rules. Local birth and remote
binding are collapsed into one successful fresh-profile outcome.
The model has no competing birth at the preferred local ID. It therefore does
not cover the SDK's `null` same-local winner result or restoration of that
winner's durable history; implementation tests must cover that path separately.

Besides these seams, only the provisioning persist (registration or
organization creation) writes the organization profile at its preferred local
ID. Member changes once opened it
there to push the profile after the commit. An install that held no row under
that ID, such as a fresh login, then birthed an empty profile whose create the
API refused with `409 document_manifest_already_exists`
([#3257](https://github.com/a2f0/tearleads/issues/3257)). Provisioning commits
the profile with the organization, so member changes no longer open it.

## Checks and fault sensitivity

The configuration checks unique local birth per remote stream, the independent
expected-identity oracle, retained payload, explicit-open refusal of creation,
and absence of stale decisions or published results.
`RequestedProfileEventuallyOpens` also requires a ready result under a stable
scope and weakly fair local work. It covers the fresh and existing-materialized
scenarios, including discovered and recovery aliases and an occupied wrong
preferred ID; a resolver that refuses every alias cannot pass.

The racing and missing-pointer scenarios are excluded from that liveness
obligation. An explicit open of a missing target must refuse. Discovery
landing after a negative lookup may safely refuse that invocation. A later
caller can resolve again, but this model does not assume an automatic retry or
promise that one invocation transparently recovers that race. The factory's
bounded re-resolution after refused initialization is an implementation path,
not a liveness guarantee proved by this model. Network progress,
hydration of remote shells, deletion during lookup, access changes, and
unbounded concurrent requests are outside the bound. Local awaits are assumed
to return successfully for the positive completion property; fresh-profile
completion abstracts successful remote creation as part of finishing open.

Registered controls change one rule at a time:

| Changed rule | Required violation |
| --- | --- |
| `AllowPointerBirth = TRUE` | `ExplicitPointerNeverCreates` |
| `PreferKnownPointer = FALSE` | `ResolvedTargetIsExpected` |
| `RespectPersistedIdentity = FALSE` | `ResolvedTargetIsExpected` |
| `ReuseDiscovered = FALSE` | `RequestedProfileEventuallyOpens` |
| `CheckCurrentScope = FALSE` | `NoStaleEffects` |
| `PreserveExistingPayload = FALSE` | `ExistingPayloadSurvives` |
| `RefuseAliasBirth = FALSE` | `NoDuplicateStreamBirths` |

These checks are bounded exploration, not an implementation refinement proof
or a cryptographic proof. The map linter checks symbol existence, not semantic
equivalence; runtime tests must exercise both profile kinds and explicit
editor opening separately from creation.
