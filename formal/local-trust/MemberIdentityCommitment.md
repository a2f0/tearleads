# Member identity commitments

[`MemberIdentityCommitment.tla`](./MemberIdentityCommitment.tla) checks the
commitment boundary for both group and organization projections (#2847). A
continuing user has one complete identity bundle, not just a KEM fingerprint.
It complements [durable pins](./DurableIdentityBinding.md) and supplies the
collision-free commitment premise of [identity-chain admission](./MemberIdentityChain.md).

| Model action or predicate | Production seam |
| --- | --- |
| `Fingerprint` / `BindCompleteBundle` | `computeUserIdentityBundleFingerprint` hashes the canonical identity-link tuple, including deployment domain, user ID, suite tags, signing key and KEM key |
| `Projection` / `BindProjection` | `encodeNormalizedPrincipalProjectionMembers` includes `identityBundleFingerprint`; `computePrincipalProjectionRoot` hashes it and `encodeUnsignedPrincipalState` signs the root |
| `Receive` / `AcceptedBundleIsCommitted` | `verifyPrincipalPolicyProjectionCommitments` checks the signed projection; `assertIdentityCommitment` compares its bundle hash with the locally pinned full identity |
| `Continue` / `CheckContinuingIdentity` | `getPrincipalPolicyTransitionMismatch` calls `getPrincipalMemberIdentityMismatch`; both API transition validation and client history verification use that shared check |
| `ContinuingIdentityIsImmutable` | `member_identity_changed` becomes a client `hash_mismatch` rather than allowing an authorized writer to replace a continuing member's identity |
| `MembershipRoot` | `computePrincipalMembershipRoot` still commits only the user-ID set; `computePrincipalMemberEnvelopesRoot` retains the existing envelope commitment |
| (boundary assumption) | `normalizePrincipalProjectionMembers` requires a lowercase 64-character `identityBundleFingerprint`; `assertPrincipalIdentityBundles` recomputes it from registered public keys in the configured deployment trust domain |

The concrete sources are
[`userIdentityBundle.ts`](../../packages/crypto/src/userIdentityBundle.ts),
[`principalState.ts`](../../packages/crypto/src/principalState.ts),
[`principalPolicyCommitments.ts`](../../packages/crypto/src/keying/principalPolicyCommitments.ts),
[`principalPolicyTransition.ts`](../../packages/crypto/src/keying/principalPolicyTransition.ts),
[API transition validation](../../packages/api/src/access/shared/internal/principalStateValidation.ts),
[API registered-key validation](../../packages/api/src/workflows/principals/principalIdentityBundles.ts),
and [chain admission](../../packages/client-sdk/src/workflows/organizations/memberships/rosterVouchedAdmission.ts).
The map checker verifies symbol existence, not call-site equivalence.

## Bounds and negative controls

The configuration explores both principal kinds, one continuing member, and
seven symbolic bundles: the original plus one independent change to each of
six components. Hash equality is represented by tuple equality, not by SHA-256
execution. Suite-tag alternatives model changes to the encoded commitment,
not additional wire suites the implementation accepts. The user-ID slot in a
bundle may be substituted while the projection's member ID remains fixed;
that must not authenticate as the original member.

`AcceptedBundleIsCommitted` requires every delivered bundle accepted under a
signed projection to equal the committed bundle. The action property
`ContinuingIdentityIsImmutable` forbids replacement by any successor for the
same member. The fixed `MembershipRoot` makes explicit that the identity is
committed through the projection, not by expanding the membership set or
changing envelope semantics.

The [negative-control registry](../../scripts/protocol/protocolMemberIdentityNegativeControls.ts)
contains three independent controls:

- `identity-bundle-only-binds-kem`: drop the other tuple components;
  `AcceptedBundleIsCommitted` must fail.
- `identity-bundle-missing-projection`: omit the fingerprint from the signed
  projection; the same invariant must fail.
- `identity-bundle-continuing-replacement`: remove the transition comparison;
  `ContinuingIdentityIsImmutable` must fail.

The positive configuration has 14 generated / 4 distinct states and graph
depth 2 with the pinned TLC toolchain. Each control produces its named
violation, not a parser error or an unrelated invariant failure.

## Boundary

This checks the abstract guard and commitment dependency, not canonical JSON,
key decoding, hash collision resistance, suite validation, signature security,
SQL atomicity, API registered-key reads, or restore-format enforcement. Roles,
principal-key rotation, and member removal/re-addition are outside this small
model; the chain model handles distinct membership intervals. No legacy
projection or migration path is admitted. Production tests, not TLC, must
establish that malformed fingerprints fail and that both API and client invoke
the shared transition check. No implementation trace is exported by this model.
