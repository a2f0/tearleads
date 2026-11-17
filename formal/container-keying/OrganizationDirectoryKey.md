# Organization directory key

[`OrganizationDirectoryKey.tla`](./OrganizationDirectoryKey.tla) models the
organization policy's key across directory writes. The organization policy
mirrors the Admins projection; every group create, group policy commit and
group delete writes a directory successor.

| Model action or predicate | Production seam |
| --- | --- |
| `Unchanged` / `KeepOrRotate` | `organizationDirectoryKeying` keeps the key, epoch and predecessor envelopes when the Admins projection is unchanged, or rotates when `heldOrganizationSecret` cannot recover the signed key |
| `verifiable` / `VerificationChanges` | `heldOrganizationSecret` returns the key only when the device holds the signer's KEM secret (`currentUserSecretKey`), exactly one envelope is the signer's, it opens, and `principalSecretKeyMatchesState` matches it to the signed key |
| `Grow` | It unwraps the held key with the signer's own envelope (`currentUserSecretKey`), checks it against the signed key, and wraps it only for the added admins |
| `Shrink` / `RotateOnShrink` | Any removed or changed member rotates to a fresh key wrapped for every remaining admin; `getPrincipalPolicyTransitionMismatch` (`shrink_without_key_rotation`) refuses a shrink that keeps the key |
| `learned` | Each envelope `wrapDekForRecipients` produces is served to its admin and cannot be withdrawn, so a user keeps every key epoch it ever unwrapped |
| `RemovedAdminLacksCurrentKey` | Revocation by rotation: `rotatedKeying` wraps the fresh key through `rewrapProjectionMemberEnvelopes` for the remaining admins only |
| `AdminsHoldCurrentKey` | `keptKeying` re-serves the predecessor's signed envelopes and `rewrapProjectionMemberEnvelopes` wraps the held key for each added admin |

Bounds are three users and four key epochs. The action property
`EpochHeldUnlessShrink` requires every write that removes no admin to keep the
epoch while the writer can verify the held key. Two negative controls:
`RotateOnShrink = FALSE` keeps the key on a removal and violates
`RemovedAdminLacksCurrentKey`; `KeepWhenVerifiable = FALSE` rotates on every
write and violates `EpochHeldUnlessShrink`.

Every rotation in the model is a fresh key, as the SDK generates. Verifiers
compare key material only with the predecessor, so they also accept a
rotation back to an older key; that has no confidentiality consequence
because the directory key encrypts no data
([security properties](../../docs/security-guarantees/properties.md)).

The model treats every envelope as opening for its admin. The SDK checks
only the signer's own envelope before keeping a key (without the signer's key
it always rotates), so a co-admin envelope that a faulty author wrapped
wrongly is carried forward until the next rotation; nothing consumes the
organization key, and every removal rotates.

Signatures, the directory payload, and the group keys are outside the model;
the transition rule and the builder are covered by
`principalPolicyTransition` tests and `organizationDirectoryKeying.test.ts`.
