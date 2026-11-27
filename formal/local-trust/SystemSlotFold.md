# System slot fold after a root fold

[`SystemSlotFold.tla`](./SystemSlotFold.tla) models a device-first system
container, such as Contacts, made under a pre-auth root with its create
queued. Sign-in or a recovery-key restore folds that root into the account
root, which may already hold the same slot (#3290). The create must not reach
the server while a listing of the account root could still fold the local
copy, a create the server refuses for a taken slot must not be retried, and
the create must not wait forever when listings never complete.

| Model action or predicate | Production seam |
| --- | --- |
| `RootFold` / `HoldOnFold` / `held` | `buildLocalRootDescendantReparents` sets `awaitParentListing` on a system-slot create re-homed onto the server root; `updateReparentedDescendantContainers` records `CONTAINER_CREATE_AWAITS_PARENT_LISTING` on its create intent |
| `ListParent` / `listedAfterHold` | a drained parent-lane listing applies the account's twin, `reconcileLocalOnlySystemContainers` folds the local copy (deleting its intent), and `markContainerParentLaneFetched` then records the lane's `checkedAt` |
| `Expire` / `HoldBound` / `expired` | `systemSlotCreateGate` posts once `SYSTEM_SLOT_CREATE_HOLD_MS` have passed since the hold; `deferSystemSlotCreate` asks `requestSyncAfter` for a pass at that time |
| `MayPost` | `systemSlotCreateGate` posts only when the parent lane's `checkedAt` is newer than the hold, or the hold expired |
| `Post` / `TypedSlotConflict` / `taken` | the API maps `containers_org_system_slot_idx` to `containerSystemSlotTaken`, a 409 with `systemSlotTaken`; `isContainerSystemSlotTakenFailure` stops the plain fallback and stale-parent retry, and `recordTakenSystemSlotCreate` records `CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE`, after which `systemSlotCreateGate` never posts it again |

Listings get no fairness, so `CreateSettles` holds only through the hold's
bound: a device whose listings never complete still posts once, and then
either commits the slot or learns it is taken. A taken slot settles when a
later listing folds the copy, which the model leaves to `ListParent`.

The model covers the queued pass, not a system container made while signed
in. That create is posted at once; if the slot is taken, the queued pass
posts it once more before it records the refusal, so that rare race posts
twice.

The configuration explores an account with and without the slot. Negative
controls drop the hold (`NoPostBeforeFoldingListing`), treat the refusal as
stale (`AtMostOnePost`), and remove the bound (`CreateSettles`).
