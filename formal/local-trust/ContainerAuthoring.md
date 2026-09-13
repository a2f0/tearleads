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
| `RefuseMutation` / `DocumentRefusalsAreVisible` | `recordDocumentCreateAccessFailure` records the local permission denial as a terminal 403 for pending document creation |

The bounded choices cover read, write, and admin grants; child, system, and
document creation; sharing, revocation, rekeying, and moves. Moves independently
require admin on the source and write on the destination. Group membership is
abstracted into its verified effective access. Later policy changes and the
server's knowledge of current policy remain outside this local authoring model.

The negative control removes the client permission check. A read-only signer
then creates a plan that a dishonest server can echo into an acknowledgement.
The SDK regressions exercise valid signed projections and require refusal before
submission; document creation must also leave a visible terminal failure.
