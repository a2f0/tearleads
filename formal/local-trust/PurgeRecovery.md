# Authenticated purge recovery

[`PurgeRecovery.tla`](./PurgeRecovery.tla) models purge recovery, where an
untrusted API returns a replacement organization/root, potentially a winning
candidate from a second device. Recovery requires this identity's explicit
signed replacement intent before adopting that destination or re-homing the
local corpus.

| Model action or predicate | Production seam |
| --- | --- |
| `ServerReportsPurged` | the unsigned billing status `recoverPurgedSessionOrganization` reads before starting |
| `StartRecovery` / `RequirePersonalOrganization` | `resolveAutomaticRecoverySignal` starts recovery only where `usePurgedOrganizationRecovery` is enabled: for an administrator of the user's own personal organization |
| `Authenticate` / `VerifyReplacement` | `verifyOrganizationReplacementResponse` verifies the identity signature and binds the old organization, user, returned organization, root, metadata document, and root genesis hash |
| `Provision` / `VerifyProvisioning` | `validateOrganizationReplacementAuthorization` checks the same authorization against the submitted genesis before creation, winner replay, and finalization |
| `freshPrivateGenesis` | `assertPersonalGenesis` restricts signing to fresh sole-founder policies and a private non-system root |
| `newCheckpoint` | `persistOrganizationReplacementCheckpoints` seeds the signed winning genesis before adoption, preserves later pins, and rejects conflicting genesis or ownership atomically |
| `Reset` / `PreserveCheckpoints` | `clearRemoteSyncState` re-homes the locally scoped corpus while retaining access and principal checkpoints and principal ownership |
| `Discover` / `ScopeDiscovery` | `documentHeadMatchesOrganization` scopes both discovery and tombstone evidence to the listed container's current organization |
| `PurgeJob` / `ReserveFreedIds` | `deleteOrganizationRemoteRows` deletes the organization's rows and, in the same transaction, `reservePurgedOrganizationObjects` writes a `purged_object_reservations` row per freed container and document id, naming the personal organization's owner; a shared organization's purge writes none |
| `OutsiderCreate` / `MemberCreate` / `ReserveForOwner` | another user's create of a copied id: `assertCreateCanAdvanceDocumentHead`, `assertMetadataDocumentAvailable`, the container insert in `persistContainerStructure`, and `createRootContainer` refuse a reservation that names another user, whichever organization the create targets |
| `Recreate` / `idHolder` | the owner's queued recovery creates, which consume the reservation in their own transaction; another owner device's create then adopts that copy through `adoptExistingRemoteDocument` or `assertContainerCreateAdoptable` |

The two candidate identities abstract two devices sharing the same signing key.
Signature validity, old-organization binding, and response binding are
independent unconstrained booleans. Cryptography and genesis hash computation
are boundary assumptions, exercised with real signatures by runtime regressions.
The modeled API and client checks are independent: a dishonest API can return a
response without taking the provisioning action. Runtime signing permits only
private personal genesis; an ordinary organization/root signature is not
replacement intent. The domain-separated authorization commits all three
principal genesis hashes and the root manifest hash.

An old [checkpoint](../../docs/glossary/sync.md#checkpoint) at version two and a
replacement genesis at version one model separate organization namespaces,
including reused local object IDs. Discovery covers live signed
[heads](../../docs/glossary/sync.md#head); globally terminal signed document purge
evidence is outside this ownership comparison. The enabled-action invariants
ensure either honest device can authenticate and reset without requiring its own
losing candidate to win. They do not claim progress under unavailable evidence,
billing, network loss, identity changes, or unfair scheduling. Durable attempt
replay, SQLite atomicity, same-epoch conflict rejection, and finalization
response checks are runtime test obligations rather than modeled transaction
internals.

Recovery starts from an active organization. The API's purged status is
unsigned, and a dishonest API may report it for an organization it never
purged. An administrator's device starts recovery on that status only for the
user's own personal organization (`RecoveryOnlyForPersonalOrganization`), so a
shared organization's members are never re-homed on the server's word.
Adoption still needs this identity's signed replacement intent, and
checkpoints survive the reset. The remaining effect of a false status on a
personal organization is that the device re-homes its own corpus into a fresh
personal organization it signed for: the server could equally withhold the
old one, so this is an availability residual, not a trust decision.

One abstract container or document id follows the purge (#3264). The honest
purge job frees it (`PurgeJob`), and recovery recreates it under the same id
after `Reset` (`Recreate`). Two other creators have no fairness: an outsider
who learned the id from history, and a member the owner re-invited into the
replacement. Under the no-brick invariant only the owner's own steps are fair,
so `RecreateCanProceed` requires that neither can disable the owner's
recreation: the reservation must exist (`ReserveFreedIds`) and must name the
owner rather than the replacement organization (`ReserveForOwner`). A
dishonest API's false purged status frees nothing, which leaves the id held by
the old organization: the existing withholding residual. Chained purges, where
a replacement lapses before every id is recovered, repeat the same step; the
runtime regressions cover them, along with each create path and the create
racing the purge.

Eight negative controls independently remove client authentication, server
validation, checkpoint retention, discovery scope, seeding the winning genesis
before adoption, the personal-organization trigger guard, the reservation of
freed ids, and keying that reservation to the owner. The adversarial runtime
regressions fail when the corresponding implementation guards are removed.
