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

The two candidate identities abstract two devices sharing the same signing key.
Signature validity, old-organization binding, and response binding are
independent unconstrained booleans. Cryptography and genesis hash computation
are boundary assumptions, exercised with real signatures by runtime regressions.
The modeled API and client checks are independent: a dishonest API can return a
response without taking the provisioning action. Runtime signing permits only
private personal genesis; an ordinary organization/root signature is not
replacement intent. The domain-separated authorization commits all three
principal genesis hashes and the root manifest hash.

An old checkpoint at version two and a replacement genesis at version one model
separate organization namespaces, including reused local object IDs. Discovery
covers live signed heads; globally terminal signed document purge evidence is
outside this ownership comparison. The enabled-action invariants ensure either
honest device can authenticate and reset without requiring its own losing
candidate to win. They do not claim progress under unavailable evidence,
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

Six negative controls independently remove client authentication, server
validation, checkpoint retention, discovery scope, seeding the winning genesis
before adoption, and the personal-organization trigger guard. The adversarial
runtime regressions fail when the corresponding implementation guards are
removed.
