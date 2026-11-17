# Organization directory key

[`OrganizationDirectoryKey.tla`](./OrganizationDirectoryKey.tla) models the
organization policy's key across directory writes. The organization policy
mirrors the Admins projection; every group create, group policy commit and
group delete writes a directory successor.

| Model action or predicate | Production seam |
| --- | --- |
| `Unchanged` | `organizationDirectoryKeying` keeps the key, epoch and predecessor envelopes when the Admins projection is unchanged |
| `Grow` | It unwraps the held key with the signer's own envelope (`currentUserSecretKey`), checks it against the signed key, and wraps it only for the added admins |
| `Shrink` / `RotateOnShrink` | Any removed or changed member rotates to a fresh key wrapped for every remaining admin; `getPrincipalPolicyTransitionMismatch` (`shrink_without_key_rotation`) refuses a shrink that keeps the key |
| `learned` | An envelope, once served, cannot be withdrawn, so a user keeps every key epoch it ever unwrapped |
| `RemovedAdminLacksCurrentKey` | Revocation by rotation: a removed admin never holds the current key |
| `AdminsHoldCurrentKey` | Every current admin can open the current key |

Bounds are three users and four key epochs. A growth without the signer's
secret rotates, which the model's `KeepOnGrow = FALSE` covers. The negative
control `RotateOnShrink = FALSE` keeps the key on a removal and violates
`RemovedAdminLacksCurrentKey`.

Signatures, the directory payload, and the group keys are outside the model;
the transition rule and the builder are covered by
`principalPolicyTransition` tests and `organizationDirectoryKeying.test.ts`.
