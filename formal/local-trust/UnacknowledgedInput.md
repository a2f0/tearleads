# Unacknowledged server input and local intent

[`UnacknowledgedInput.tla`](./UnacknowledgedInput.tla) models findings #12
and #16 in #2266. An unsigned listing must not adopt a pending document create
or redirect its queued edits. Login must not change an already acknowledged
user ID for the same signing identity.

| Model action or predicate | Production seam |
| --- | --- |
| `Discover` | `upsertDiscoveredDocumentWithExec` returns `loadPendingCreateSummary` unchanged |
| `DeferLinkDiscovery` / `linkedScope` | `withoutDeferredDocumentLinks` preserves pending link projections in single and batched discovery |
| `VerifyCreate` | `adoptExistingRemoteDocument` checks `assertExpectedAdoptionScope` and verifies the projection |
| `SwitchIdentity` | `IdentityService.setKeyPairs` changes the active signing identity |
| `BeginLogin` / `FinishLogin` | `SessionService.login` captures and rechecks the identity snapshot |
| `EnforceLoginBinding` | `SessionIdentityAcknowledgments.assertMatches` runs before pinning login's user ID |
| `Reboot` | a fresh `SessionIdentityAcknowledgments` map after a boot that restores no persisted session; the durable pin rows survive |
| `DurablePinRebindCheck` / `pinned` | `selectStoredPin` scopes durable pins by trust domain and user ID; login does not cross-check the fingerprint against other user IDs, which is the vulnerable behavior until fixed |
| `HostRestore` / `CheckRestoreIdentity` | `useRestorePersistedSession` compares the live signing fingerprint before applying persisted context |
| `acknowledged` | `SessionIdentityAcknowledgments.remember` records successful auth and host-restored context |

The configuration has two identities, two user IDs, and two document scopes.
It begins with one restored identity acknowledgment; the other identity may
establish its first binding. TLC explores repeated login attempts, switching
identities while login is pending, unsigned discovery, verified adoption, and
reboots that clear the in-memory acknowledgment while the durable pins
persist. Failed create verification is modeled as taking no adoption step.
It checks that adoption preserves the verified intended scope, that no
existing acknowledgment changes, and that a durably pinned identity can never
be rebound to another user ID after a reboot. The five vulnerable rules have
registered negative controls; production currently behaves like negative
control `reboot-rebinds-pinned-identity` until the issue is fixed.

The identity abstraction is a signing-key fingerprint within one SDK client's
API trust domain. Host-restored context is trusted and was loaded from encrypted
storage keyed by that fingerprint. Unacknowledged local user selections and
failed registration pins are not acknowledgments. The model does not prove
cryptography, storage encryption, first-contact identity assignment, legitimate
relinking after adoption, or later document synchronization. Finding #18's
private-key consistency check is below this model's cryptographic abstraction;
its regression uses real ML-KEM envelopes, including a forged public-key part.
