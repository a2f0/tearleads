# Organization directory key

[`OrganizationDirectoryKey.tla`](./OrganizationDirectoryKey.tla) models the
organization policy's key across directory writes. The organization policy
mirrors the Admins projection; every group create, group policy commit and
group delete writes a directory successor.

| Model action or predicate | Production seam |
| --- | --- |
| `Unchanged` | `organizationDirectoryKeying` keeps the key, epoch and predecessor envelopes when the Admins projection is unchanged, or rotates when `heldOrganizationSecret` cannot recover the signed key |
| `Grow` | It unwraps the held key with the signer's own envelope (`currentUserSecretKey`), checks it against the signed key, and wraps it only for the added admins |
| `Shrink` / `RotateOnShrink` | Any removed or changed member rotates to a fresh key wrapped for every remaining admin; `getPrincipalPolicyTransitionMismatch` (`shrink_without_key_rotation`) refuses a shrink that keeps the key |
| `learned` | Each envelope `wrapDekForRecipients` produces is served to its admin and cannot be withdrawn, so a user keeps every key epoch it ever unwrapped |
| `RemovedAdminLacksCurrentKey` | Revocation by rotation: `rotatedKeying` wraps the fresh key through `rewrapProjectionMemberEnvelopes` for the remaining admins only |
| `AdminsHoldCurrentKey` | `keptKeying` re-serves the predecessor's signed envelopes and `rewrapProjectionMemberEnvelopes` wraps the held key for each added admin |

Bounds are three users and four key epochs. A growth without the signer's
secret rotates, which the model's `KeepOnGrow = FALSE` covers. The negative
control `RotateOnShrink = FALSE` keeps the key on a removal and violates
`RemovedAdminLacksCurrentKey`.

The model treats every envelope as opening for its admin. The SDK checks
only the signer's own envelope before keeping a key (without the signer's key
it always rotates), so a co-admin envelope that a faulty author wrapped
wrongly is carried forward until the next rotation; nothing consumes the
organization key, and every removal rotates.

Signatures, the directory payload, and the group keys are outside the model;
the transition rule and the builder are covered by
`principalPolicyTransition` tests and `organizationDirectoryKeying.test.ts`.
