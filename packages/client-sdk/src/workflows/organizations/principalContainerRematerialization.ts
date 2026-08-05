import type {
  ContainerDirectGrant,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  OrganizationGroupContainerResponse,
} from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import type { ContainerMutationAuthor } from "../../data/containers/shared/types";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  buildMaterializedContainerRekeyPlan,
  buildMaterializedContainerRevokePlan,
  buildMaterializedContainerSharePlan,
} from "../containers";

interface RematerializationApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

interface PrincipalContainerRematerializationInput {
  readonly apiClient: RematerializationApi;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly grants: readonly OrganizationGroupContainerResponse[];
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly revokedContainerId?: string | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly targetSecretKey: Uint8Array;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

function matchingGroupGrant(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly groupId: string;
}): ContainerDirectGrant | null {
  return (
    input.directGrants.find(
      (grant) =>
        grant.subjectType === "group" && grant.subjectId === input.groupId,
    ) ?? null
  );
}

function referencedGroupKeyEpoch(input: {
  readonly groupId: string;
  readonly referencedPrincipalHeads: ReturnType<
    typeof readContainerState
  >["referencedPrincipalHeads"];
}): number | null {
  return (
    input.referencedPrincipalHeads.find(
      (head) =>
        head.principalType === "group" && head.principalId === input.groupId,
    )?.keyEpoch ?? null
  );
}

async function loadGrantedContainerContext(
  input: PrincipalContainerRematerializationInput,
  grantRow: OrganizationGroupContainerResponse,
) {
  const projection = await input.apiClient.getContainerWriterProjection(
    grantRow.containerId,
  );
  if (!projection) {
    throw new Error(
      `Container ${grantRow.containerId} could not be prepared for principal rotation`,
    );
  }
  const state = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  const grant = matchingGroupGrant({
    directGrants: state.directGrants,
    groupId: input.groupId,
  });
  if (!grant || grant.accessLevel !== grantRow.accessLevel) {
    throw new Error(
      `Container ${grantRow.containerId} does not contain the expected group grant`,
    );
  }
  const referencedKeyEpoch = referencedGroupKeyEpoch({
    groupId: input.groupId,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  });
  if (referencedKeyEpoch === null) {
    throw new Error(
      `Container ${grantRow.containerId} is missing its group reference`,
    );
  }
  return { grant, projection, referencedKeyEpoch };
}

export async function buildPrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<ContainerMutationRequest[]> {
  const resolveProjectionUserKey = createProjectionUserKeyResolver({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const requests: ContainerMutationRequest[] = [];
  for (const grantRow of [...input.grants].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  )) {
    const { grant, projection, referencedKeyEpoch } =
      await loadGrantedContainerContext(input, grantRow);

    const author = {
      ...input.author,
      organizationId: projection.organizationId,
    };
    if (grantRow.containerId === input.revokedContainerId) {
      const planned = await buildMaterializedContainerRevokePlan({
        author,
        execSql: input.execSql,
        previousProjection: projection,
        replacementPrincipalPolicy: input.nextPolicy,
        revokedSubject: {
          subjectId: input.groupId,
          subjectType: "group",
        },
        resolveProjectionUserKey,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
      requests.push(planned.plan.request);
      continue;
    }
    if (referencedKeyEpoch === input.nextPolicy.keyEpoch) {
      const planned = await buildMaterializedContainerSharePlan({
        accessLevel: grant.accessLevel,
        author,
        execSql: input.execSql,
        previousProjection: projection,
        recipient: {
          principalPolicy: input.nextPolicy,
          subjectId: input.groupId,
          subjectType: "group",
        },
        resolveProjectionUserKey,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
      requests.push(planned.plan.request);
      continue;
    }

    const planned = await buildMaterializedContainerRekeyPlan({
      author,
      execSql: input.execSql,
      previousProjection: projection,
      replacementPrincipalPolicy: input.nextPolicy,
      resolveProjectionUserKey,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    requests.push(planned.plan.request);
  }
  if (
    input.revokedContainerId &&
    !input.grants.some(
      (grant) => grant.containerId === input.revokedContainerId,
    )
  ) {
    throw new Error("Revoked container is not granted to the group");
  }
  return requests;
}
