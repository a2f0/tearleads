import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import type { ContainerReplacementAuthorizationsResponse } from "@tearleads/validators/operation";
import { isCreateOrganizationResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "./writerProjection";
import { flushVerificationMarkersAfterRead } from "./writerProjection/verificationMarkers";

/** The signed proof that a purged organization's replacement is its next link. */
function purgedReplacementProof(
  organizationId: string,
  billing:
    | {
        readonly status: string | null;
        readonly replacementOrganizationId: string | null;
        readonly response: unknown;
      }
    | undefined,
) {
  const response = billing?.response;
  if (billing?.status !== "purged" || !isCreateOrganizationResponse(response))
    return null;
  const proof = response.replacementAuthorization;
  if (
    !proof ||
    proof.replacesOrganizationId !== organizationId ||
    proof.organizationId !== billing.replacementOrganizationId ||
    proof.organizationId !== response.organizationId ||
    proof.userId !== response.userId
  )
    return null;
  return proof;
}

/** Only a current reader of the re-shared destination may discover its lineage. */
export async function runContainerReplacementAuthorizationsWorkflow(
  db: ApiDatabase,
  input: {
    readonly containerId: string;
    readonly replacesOrganizationId: string;
    readonly userId: string;
  },
): Promise<ContainerReplacementAuthorizationsResponse> {
  const { markers, authorizations } = await db.transaction(async (tx) => {
    const context = createContainerWriterProjectionContext(tx);
    const access = await resolveContainerAccessProjection({
      containerId: input.containerId,
      context,
      executor: tx,
      minimumAccessLevel: "read",
      userId: input.userId,
    });
    const destination = access.verifiedPath.at(-1)?.state.organizationId;
    const authorizations: ContainerReplacementAuthorizationsResponse["authorizations"] =
      [];
    const visited = new Set<string>();
    let organizationId = input.replacesOrganizationId;
    while (organizationId !== destination) {
      if (visited.has(organizationId)) break;
      visited.add(organizationId);
      const [billing] = await tx
        .select({
          status: organizationBilling.status,
          replacementOrganizationId:
            organizationBilling.replacementOrganizationId,
          response: organizationBilling.replacementProvisioningResponse,
        })
        .from(organizationBilling)
        .where(eq(organizationBilling.organizationId, organizationId))
        .limit(1);
      const proof = purgedReplacementProof(organizationId, billing);
      if (!proof) break;
      authorizations.push(proof);
      organizationId = proof.organizationId;
    }
    if (organizationId !== destination || authorizations.length === 0)
      throw new ContainerWriterProjectionError(
        "Replacement authorization unavailable",
        404,
      );
    return { authorizations, markers: context.verificationMarkers };
  });
  await flushVerificationMarkersAfterRead(markers, db);
  return { authorizations };
}
