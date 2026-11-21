import type { ContainerKekKeyringEntry } from "@tearleads/crypto";
import type { ContainerRotationResponse } from "@tearleads/validators/response";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  ContainerRekeyPlan,
} from "../../../../data/containers/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../../data/keyingProjectionVerification";
import {
  type ContainerRotationCollaborators,
  containerRotationBag,
} from "../../containerMutationCollaborators";
import {
  submitAcknowledgedContainerMutation,
  submitContainerRotation,
} from "../mutationSubmit";
import { buildMaterializedContainerRekeyPlan } from "./index";

export interface RekeyRemoteContainerRequest {
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  keyringEntriesOverride?: readonly ContainerKekKeyringEntry[] | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

export interface RekeyedRemoteContainer {
  containerKey: Uint8Array;
  plan: ContainerRekeyPlan;
  response: ContainerRotationResponse;
}

export async function rekeyRemoteContainer(
  collaborators: ContainerRotationCollaborators<ContainerRekeyApi>,
  request: RekeyRemoteContainerRequest,
): Promise<RekeyedRemoteContainer | null> {
  const input = { ...request, ...containerRotationBag(collaborators) };
  const previousProjection = await input.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!previousProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerRekeyPlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    keyringEntriesOverride: input.keyringEntriesOverride,
    previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    signedAt: input.signedAt,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    reportSecurityIncident: input.reportSecurityIncident,
    recitationPolicies: [],
    apiClient: input.apiClient,
    author: input.author,
    carriedRekeys: {
      planning: {
        apiClient: input.apiClient,
        author: input.author,
        execSql: input.execSql,
        knownContainerKeks: new Map([
          [
            materializedPlan.plan.containerKeyEpochId,
            materializedPlan.containerKey,
          ],
        ]),
        resolveProjectionUserKey: input.resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      },
      rotated: async () => materializedPlan.writerProjection,
    },
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
    submit: (carried) => {
      const request = carried.length
        ? { ...materializedPlan.plan.request, containerRekeys: [...carried] }
        : materializedPlan.plan.request;
      const options = {
        expectedPaymentRequiredOrganizationId: input.author.organizationId,
        stillCurrent: input.stillCurrent,
      };
      const { rekeyContainerResult } = input.apiClient;
      return submitContainerRotation({
        plain: () =>
          input.apiClient.rekeyContainer(input.containerId, request, options),
        result: rekeyContainerResult
          ? () =>
              rekeyContainerResult.call(
                input.apiClient,
                input.containerId,
                request,
                { ...options, reportErrors: false },
              )
          : undefined,
      });
    },
  });
}
