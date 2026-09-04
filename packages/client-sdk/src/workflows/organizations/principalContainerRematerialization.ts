import type {
  ContainerDirectGrant,
  PrincipalContainerGrant,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../data/containers/shared/heldContainerHeads";
import type { AuthoredContainerMutationHead } from "../../data/containers/shared/mutationAcknowledgement";
import { acknowledgeContainerMutationBatch } from "../../data/containers/shared/mutationAcknowledgement";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import type { ContainerReciteApi } from "../../data/containers/shared/reciteApi";
import type {
  ContainerMutationAuthor,
  MaterializedContainerRekeyPlan,
  MaterializedContainerRevokePlan,
  MaterializedContainerSharePlan,
} from "../../data/containers/shared/types";
import {
  type ReferencedPrincipalPolicyWarmer,
  verifyContainerWriterProjection,
} from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { scheduleHeldDescendantRecitations } from "../containers/child/recite";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { buildMaterializedContainerRevokePlan } from "../containers/child/revoke";
import { buildMaterializedContainerSharePlan } from "../containers/child/shareMaterialization";

interface RematerializationApi extends ContainerReciteApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

interface PrincipalContainerRematerializationInput {
  readonly apiClient: RematerializationApi;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly grants: readonly PrincipalContainerGrant[];
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly revokedContainerId?: string | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
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
  grantRow: PrincipalContainerGrant,
) {
  const projection = await input.apiClient.getContainerWriterProjection(
    grantRow.containerId,
  );
  if (!projection) {
    throw new Error(
      `Container ${grantRow.containerId} could not be prepared for principal rotation`,
    );
  }
  await verifyContainerWriterProjection({
    execSql: input.execSql,
    projection,
    resolveUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const state = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  const grant = matchingGroupGrant({
    directGrants: state.directGrants,
    groupId: input.groupId,
  });
  if (grant && grant.accessLevel !== grantRow.accessLevel) {
    const nextGrant = input.nextPolicy.grants.find(
      (candidate) => candidate.containerId === grantRow.containerId,
    );
    if (!nextGrant || nextGrant.accessLevel !== grantRow.accessLevel) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the expected group grant`,
      );
    }
  }
  const referencedKeyEpoch = referencedGroupKeyEpoch({
    groupId: input.groupId,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  });
  if (grant && referencedKeyEpoch === null) {
    throw new Error(
      `Container ${grantRow.containerId} is missing its group reference`,
    );
  }
  return { grant, projection, referencedKeyEpoch };
}

export async function buildPrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<ContainerMutationRequest[]> {
  return (await buildPrincipalContainerRematerializationPlans(input)).map(
    (planned) => planned.plan.request,
  );
}

type MaterializedPrincipalContainerMutationPlan =
  | MaterializedContainerRekeyPlan
  | MaterializedContainerRevokePlan
  | MaterializedContainerSharePlan;

export interface PreparedPrincipalContainerRematerializationBatch {
  readonly acknowledge: (
    responses: readonly ContainerMutationResponse[],
    stillCurrent?: (() => boolean) | undefined,
  ) => Promise<void>;
  readonly plans: readonly MaterializedPrincipalContainerMutationPlan[];
  readonly requests: readonly ContainerMutationRequest[];
}

function authoredMutationHead(
  planned: MaterializedPrincipalContainerMutationPlan,
): AuthoredContainerMutationHead {
  return planned.plan;
}

async function buildPrincipalContainerRematerializationPlan(input: {
  readonly grantRow: PrincipalContainerGrant;
  readonly rematerialization: PrincipalContainerRematerializationInput;
  readonly resolveProjectionUserKey: ReturnType<
    typeof createProjectionUserKeyResolver
  >;
}): Promise<MaterializedPrincipalContainerMutationPlan> {
  const { grantRow, rematerialization } = input;
  const { grant, projection, referencedKeyEpoch } =
    await loadGrantedContainerContext(rematerialization, grantRow);
  const nextGrant = rematerialization.nextPolicy.grants.find(
    (candidate) => candidate.containerId === grantRow.containerId,
  );
  const author = {
    ...rematerialization.author,
    organizationId: projection.organizationId,
  };
  const sharedInput = {
    author,
    execSql: rematerialization.execSql,
    previousProjection: projection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: rematerialization.stillCurrent,
    targetSecretKey: rematerialization.targetSecretKey,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  };
  if (grantRow.containerId === rematerialization.revokedContainerId) {
    if (!grant) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the revoked group grant`,
      );
    }
    return buildMaterializedContainerRevokePlan({
      ...sharedInput,
      replacementPrincipalPolicy: rematerialization.nextPolicy,
      revokedSubject: {
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  if (!grant || grant.accessLevel !== nextGrant?.accessLevel) {
    if (!nextGrant) {
      throw new Error(
        `Container ${grantRow.containerId} is absent from the next group grant set`,
      );
    }
    return buildMaterializedContainerSharePlan({
      ...sharedInput,
      accessLevel: nextGrant.accessLevel,
      recipient: {
        principalPolicy: rematerialization.nextPolicy,
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  if (referencedKeyEpoch === rematerialization.nextPolicy.keyEpoch) {
    return buildMaterializedContainerSharePlan({
      ...sharedInput,
      accessLevel: grant.accessLevel,
      recipient: {
        principalPolicy: rematerialization.nextPolicy,
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  return buildMaterializedContainerRekeyPlan({
    ...sharedInput,
    replacementPrincipalPolicy: rematerialization.nextPolicy,
  });
}

async function buildPrincipalContainerRematerializationPlans(
  input: PrincipalContainerRematerializationInput,
): Promise<MaterializedPrincipalContainerMutationPlan[]> {
  if (
    input.revokedContainerId &&
    !input.grants.some(
      (grant) => grant.containerId === input.revokedContainerId,
    )
  ) {
    throw new Error("Revoked container is not granted to the group");
  }
  const resolveProjectionUserKey = createProjectionUserKeyResolver({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const plans: MaterializedPrincipalContainerMutationPlan[] = [];
  for (const grantRow of [...input.grants].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  )) {
    plans.push(
      await buildPrincipalContainerRematerializationPlan({
        grantRow,
        rematerialization: input,
        resolveProjectionUserKey,
      }),
    );
  }
  return plans;
}

export async function preparePrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<PreparedPrincipalContainerRematerializationBatch> {
  const plans = await buildPrincipalContainerRematerializationPlans(input);
  return {
    plans,
    requests: plans.map((planned) => planned.plan.request),
    acknowledge: async (responses, stillCurrent) => {
      await acknowledgeContainerMutationBatch({
        execSql: input.execSql,
        plans: plans.map(authoredMutationHead),
        responses,
        stillCurrent,
      });
      if (stillCurrent?.() === false) return;
      rememberVerifiedContainerHeads({
        organizationId: input.author.organizationId,
        execSql: input.execSql,
        heads: [],
        policies: [input.nextPolicy],
      });
      scheduleHeldDescendantRecitations({
        apiClient: input.apiClient,
        author: input.author,
        execSql: input.execSql,
        plans: plans.map(authoredMutationHead),
        stillCurrent,
      });
    },
  };
}
