# Envelope set reference

[`EnvelopeSetReference.tla`](./EnvelopeSetReference.tla) models a principal
policy successor that sends its member envelopes as changes to its
predecessor's set (#2903 P17). Within the predecessor's key epoch the leg
carries an empty `memberEnvelopes` list and `memberEnvelopeChanges` (removed
users and added or replaced envelopes); the server rebuilds the full set and
then runs every check a full list gets.

| Model action or predicate | Production seam |
| --- | --- |
| `Author` | `withHeldMemberEnvelopeChanges` sends a leg as `withMemberEnvelopeChanges` when the device holds the cited predecessor and its envelopes match their signed root; otherwise the leg goes in full. A faulty author's basis stands for changes computed against the wrong set |
| `Rebuild` | `rebuildMemberEnvelopes` applies the changes to the envelopes `listPrincipalMemberEnvelopesForState` returns for `state.prevStateHash`, which never change once written, and refuses a leg outside the predecessor's key epoch |
| `CheckRoot` | `validatePrincipalStateArtifacts` refuses a set whose root differs from the signed `memberEnvelopesRoot` |
| `ReplayKey` / `HashRebuilt` | The services rebuild every leg before the workflow, so `principalPolicyCommitOutcome` hashes the rebuilt request and a retry in either form replays the commit |
| `StoredMatchesSigned` | `insertAndVerifyPrincipalMemberEnvelopeRows` stores the rebuilt rows and rechecks their root against the signed one |
| `OwnCommitNeverRefused` | `principalPolicyCommitOutcome` answers a retry after a lost acknowledgement with the stored receipt, never a conflict |

Bounds are two members and three versions. Negative controls:
`CheckRoot = FALSE` stores a faulty author's rebuilt set and violates
`StoredMatchesSigned`; `HashRebuilt = FALSE` keys replays by the wire form, so
a retry in the other form is refused and violates `OwnCommitNeverRefused`.

The model abstracts envelopes to member ids and the root to the set itself.
The epoch rule is covered by `memberEnvelopeReferences.test.ts`: the root
check alone would refuse reused envelopes of an older key, and the explicit
rule names the cause.
