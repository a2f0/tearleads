# Authorization before signing a container operation

[`ContainerAuthoring.tla`](./ContainerAuthoring.tla) separates fetching a valid
read projection from permission to author a mutation. The signed source and
destination grants determine permission; a successful projection response does
not. The server may echo any plan the client signs without checking authority.

| Model action or predicate | Production seam |
| --- | --- |
| `FetchVerifiedProjection` | `unwrapContainerKekPath` verifies the signed path before exposing keys to the materialized planners |
| `CanAuthor` / `SignMutation` / `CheckAuthorAccess` | `assertContainerAuthorAccess` checks current membership in the verified path before creating a signed event |
| `EchoAcknowledgement` / `AcknowledgementsHaveAuthority` | `acknowledgeContainerMutation` and `acknowledgeDocumentMutation` may trust matching local plans only after authoring checked permission |
| `ForgedAcknowledgement` / `CheckAcknowledgedHead` | `assertResponseIdentity` refuses a response whose `manifestHash`, `eventHash`, or epoch differs from the signed plan, and `assertResponseCommitments` refuses mismatched KEK commitments, before any checkpoint advances |
| `AcknowledgedCheckpointIsSigned` | `locallyAcknowledgedContainerMutationHead` builds the checkpoint only from the plan's `manifest` and `manifestHash`, never from response material |
| `RefuseMutation` / `DocumentRefusalsAreVisible` | `recordDocumentAuthorAccessFailure` records the local permission denial as a terminal 403 for pending document creation |

The bounded choices cover read, write, and admin grants; child, system, and
document creation and link/unlink; sharing, revocation, rekeying, and moves.
Moves independently require admin on the source and write on the destination.
Document links require write on the target and on an existing linked source.
Group membership is abstracted into its verified effective access. Later policy
changes and the server's knowledge of current policy remain outside this local
authoring model. The effective grant belongs to the signed target organization.
For child and document creation, the signer's active personal organization does
not replace that target scope; cross-organization readers still cannot author
writes.

Acknowledgements are checked by hash, not echoed (#2716): the server returns
only the head it committed (manifest hash, event hash, epochs, and KEK
commitments), and the client compares each with its signed plan before it pins
anything. `ForgedAcknowledgement` lets the dishonest server name a head the
client never signed; the client refuses it and the mutation stays
unacknowledged. `AcknowledgedCheckpointIsSigned` requires every accepted
acknowledgement to pin exactly the signed plan's manifest head, so the model
now tells the hash comparison apart from blind acceptance.

Two negative controls disable one guard each. The first removes the client
permission check. A read-only signer
then creates a plan that a dishonest server can echo into an acknowledgement.
The SDK regressions exercise valid signed projections and require refusal before
submission; document creation must also leave a visible terminal failure.

The second (`CheckAcknowledgedHead = FALSE`, control
`ack-accepts-unsigned-head`) accepts a response without comparing its hashes:
a forged acknowledgement then pins a head this client never signed, violating
`AcknowledgedCheckpointIsSigned`. `shareAcknowledgementHashes.test.ts` covers the
same mismatches against signed plans.
