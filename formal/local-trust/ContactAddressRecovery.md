# Contact address admission and uncertain-outcome recovery

[`ContactAddressRecovery.tla`](./ContactAddressRecovery.tla) models one address
draft across a first attempt and one retry. It separates queue admission, live
mutation, local persistence, result acknowledgement, and explicit no-effect
refusal. A returned row ID alone does not prove that any effect occurred.

## Bound and production mapping

The bound chooses add, update, or remove for one draft, with two possible row
IDs, one caller expiry, and an independently expiring original add authority.
Original authority may expire between attempts or during any retry phase,
including reconciliation, mutation, persistence, and acknowledgement.
The live rows, published rows, and durable rows are separate: a failed add can
exist in Loro but be absent from the published snapshot. A dirty retry first
flushes under its admitted authority, then reconciles the returned ID. A clean
absence permits another add; a present row reuses the same identity.

The writer and per-draft creation state live in
[`contactAddressWrites.ts`](../../packages/app/src/stores/documents/contactAddressWrites.ts)
and
[`contactAddressCreationState.ts`](../../packages/app/src/stores/documents/contactAddressCreationState.ts).
The UI recovery state lives in
[`contactAddressEditorMachine.ts`](../../packages/app/src/document-types/contact/contactAddressEditorMachine.ts).

| Model action or predicate | Production seam |
| --- | --- |
| `Submit`, `Admit`, `Authorized` | `queue`, `captureWriter`, `mutationOptions`, and `canWrite` in the address adapter; the guard reaches `persistRowMutation` through `DocumentMutationGuard` |
| `ApplyMutation` | `addRowToDocumentStore`, `updateRowInDocumentStore`, and `removeRowFromDocumentStore` admitting the operation through the SDK queue before live mutation |
| `FinishPersistence` | `persistRowMutation` awaiting `persistDocument`; authority expiry after admission is not rollback |
| `NoEffectReturn` | `addRowToDocumentStore` returning its allocated ID even if readiness or admission refuses the mutation |
| `FlushPending`, `Reconcile` | `flushPending`, `reconcileCreation`, and `transitionContactAddressCreation` using clean state before deciding whether another add is safe |
| `FinishAttempt` | `saved` and `writable` checking current authority and durable content before the address adapter acknowledges success |
| `RefuseAttempt`, `Cancel` | `ContactAddressWriteRefusal`, `finishOperation`, and `cancelEditor` preserving uncertainty from earlier attempts |
| `ExpireOriginal` | `addContactAddressRow` retaining the original `CreationAttempt.current` in addition to the retry caller's authority |

`RefuseAttempt` is the typed no-effect refusal available for update/remove
preflight, not an assumption that every failed SDK call is side-effect-free.
After an uncertain failure, another refusal leaves cancellation blocked. The
model permits the already-admitted persistence to finish after expiry but
never permits that stale caller to acknowledge success.

## Checks and controls

Safety checks require current authority at each modeled effect, one row per add
draft, durable and current acknowledgements, and no cancellation that forgets
an uncertain outcome.

| Changed rule | Required violation |
| --- | --- |
| `RequireAdmission = FALSE` | `OnlyAdmittedEffects` |
| `KeepOriginalAuthority = FALSE` | `OnlyAdmittedEffects` |
| `RequireCleanReconciliation = FALSE` | `OneRowPerDraft` |
| `PreserveUncertainty = FALSE` | `UncertainCannotCancel` |
| `TrustAllocatedId = TRUE` | `AcknowledgementIsDurable` |
| `CheckCompletionScope = FALSE` | `NoStaleAcknowledgement` |

The `RequireCleanReconciliation` fault bypasses the entire flush-and-clean
reconciliation barrier: it allows a dirty retry to skip `FlushPending` and
decide from stale published rows. It does not represent removing only the
cleanliness predicate inside `reconcileCreation`; production also awaits and
validates `flushPending` before calling that helper.

This is deliberately a bounded safety model. Persistence may keep failing and
a scope may expire, so it has no unconditional retry-completion property. It
assumes a retry flush succeeds when modeled; production failure must retain
the uncertain state instead. A blocked action may stutter, which is not proof
of useful progress. Positive profile and self-contact completion are checked
separately by their identity models.

Fields, unknown rows, timestamps, and attribution are not represented. The
single applied-intent bit abstracts a local patch, not per-cell conflict
resolution, revert-before-retry semantics, or Loro merge correctness. Multiple
independent identical drafts, failures before an add returns an ID, changing a
row's type, and replacement editor request tokens remain implementation-test
boundaries. Durable success means local persistence, not remote sync.
