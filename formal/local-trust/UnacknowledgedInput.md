# Unacknowledged server input and local intent

[`UnacknowledgedInput.tla`](./UnacknowledgedInput.tla) checks that an unsigned
listing cannot adopt a pending document create or redirect its queued edits, and
that login cannot change an already acknowledged user ID for the same signing
identity.

| Model action or predicate | Production seam |
| --- | --- |
| `Discover` | `upsertDiscoveredDocumentsInTransaction` (set reads and the per-row walk) returns `loadPendingCreateSummary` unchanged |
| `DeferLinkDiscovery` / `linkedScope` | `withoutDeferredDocumentLinks` preserves pending link projections in single and batched discovery |
| `VerifyCreate` | `adoptExistingRemoteDocument` checks `assertExpectedAdoptionScope` and verifies the projection |
| `SwitchIdentity` | `IdentityService.setKeyPairs` changes the active signing identity |
| `BeginLogin` / `FinishLogin` / `CheckLoginIdentity` | `SessionService.login` captures and rechecks the identity snapshot, dropping a login that finishes under another identity |
| `EnforceLoginBinding` | `SessionIdentityAcknowledgments.assertMatches` runs before pinning login's user ID |
| `HostRestore` / `CheckRestoreIdentity` | `useRestorePersistedSession` compares the live signing fingerprint before applying persisted context |
| `acknowledged` | `SessionIdentityAcknowledgments.remember` records successful auth and host-restored context |

The configuration has two identities, two user IDs, and two document scopes.
It begins with one restored identity acknowledgment; the other identity may
establish its first binding. TLC explores repeated login attempts, switching
identities while login is pending, unsigned discovery, and verified adoption.
Failed create verification is modeled as taking no adoption step.
It checks that adoption preserves the verified intended scope, that no
existing acknowledgment changes, and that a login finishing after an identity
switch never acknowledges its user for the new identity
(`LoginsKeepIdentity`). The five vulnerable rules have registered negative
controls; `CheckLoginIdentity = FALSE` binds the first login's user to an
identity that never authenticated. A pending container create has its own model,
[`ContainerCreateAdoption.tla`](./ContainerCreateAdoption.tla), since its
adoption and owed move share no state with these rules.

The identity abstraction is a signing-key fingerprint within one SDK client's
API trust domain. Host-restored context is trusted and was loaded from encrypted
storage keyed by that fingerprint. Unacknowledged local user selections and
failed registration pins are not acknowledgments. The model does not prove
cryptography, storage encryption, first-contact identity assignment, legitimate
relinking after adoption, or later document synchronization. The private-key
consistency check sits below this model's cryptographic abstraction; its
regression uses real ML-KEM envelopes, including a forged public-key part.
