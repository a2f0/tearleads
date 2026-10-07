import type { MaterializedContainerSharePlan } from "../../../data/containers/shared/types";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { commitCurrentGroupPolicyMutation } from "../../organizations/commitCurrentGroupPolicyMutation";
import { createRuntimeGroupMetadataAccess } from "../../organizations/groupMetadataRuntime";
import { buildSetGroupContainerGrantPolicyRequest } from "../../organizations/groupPolicyRequests";
import {
  type PreparedPrincipalContainerRematerializationBatch,
  preparePrincipalContainerRematerializationBatch,
} from "../../organizations/principalContainerRematerialization";
import { groupPolicyNameMismatch } from "../../organizations/principalPolicyRequest";
import type {
  createRuntimeCurrentGroupMutation,
  RuntimeCurrentGroupMutationContext,
} from "../../organizations/runtimeCurrentGroupMutation";
import type { createRuntimeCurrentSharePrincipalPolicy } from "./currentSharePrincipalPolicy";
import type { shareRemoteContainerWithGroup } from "./share";
import { GroupShareNameMismatchError } from "./sharePrincipalPolicy";

/** Fresh mutation authority rechecks the chosen name before authoring a grant. */
export async function commitCurrentShareGrant(input: {
  readonly runtime: Parameters<
    typeof createRuntimeCurrentSharePrincipalPolicy
  >[0];
  readonly share: Parameters<typeof shareRemoteContainerWithGroup>[0];
  readonly recitationStillCurrent?: (() => boolean) | undefined;
  readonly mutate: NonNullable<
    ReturnType<typeof createRuntimeCurrentGroupMutation>
  >;
}): ReturnType<typeof shareRemoteContainerWithGroup> {
  const share = input.share;
  const expectedName = share.expectedGroupName;
  if (expectedName === null)
    throw new Error(
      "Minting a group grant requires the chosen group name; only a re-wrap of an existing signed grant may omit it",
    );
  const signingKeyPair = share.signingKeyPair;
  if (!signingKeyPair)
    throw new Error(
      "Container group share requires principal policy signing context",
    );
  return input.mutate(
    {
      groupId: share.recipientGroupId,
      organizationId: share.author.organizationId,
      signerUserId: share.author.signerUserId,
      stillCurrent: share.stillCurrent ?? (() => true),
    },
    async (context) => {
      await assertCurrentShareGrantName(
        input.runtime,
        share,
        context,
        expectedName,
      );
      const request = await buildSetGroupContainerGrantPolicyRequest({
        ...context,
        accessLevel: share.accessLevel,
        containerId: share.containerId,
        signerUserId: share.author.signerUserId,
        signingFingerprint: share.author.signerKeyFingerprint,
        signingKeyPair,
      });
      const prepared: {
        batch?: PreparedPrincipalContainerRematerializationBatch;
      } = {};
      const response = await commitCurrentGroupPolicyMutation({
        apiClient: share.apiClient,
        context,
        groupId: share.recipientGroupId,
        organizationId: share.author.organizationId,
        request,
        signerUserId: share.author.signerUserId,
        signingFingerprint: share.author.signerKeyFingerprint,
        signingKeyPair,
        resolveTrustedUserIdentity: share.resolveTrustedUserIdentity,
        prepareContainerMutations: async (nextPolicy) => {
          prepared.batch = await prepareCurrentShareGrantBatch(
            share,
            context,
            nextPolicy,
            input.recitationStillCurrent,
          );
          return prepared.batch;
        },
      });
      const index =
        prepared.batch?.plans.findIndex(
          (planned) => planned.plan.containerId === share.containerId,
        ) ?? -1;
      const plan = prepared.batch?.plans[index];
      const acknowledgement = response.containerMutations[index];
      if (!plan || !acknowledgement || !isSharePlan(plan))
        throw new Error("Container group share acknowledgement is incomplete");
      return {
        containerKey: plan.containerKey,
        plan: plan.plan,
        response: acknowledgement,
      };
    },
  );
}

function isSharePlan(
  plan: PreparedPrincipalContainerRematerializationBatch["plans"][number],
): plan is MaterializedContainerSharePlan {
  return plan.plan.body.eventType === "container.grant";
}

async function assertCurrentShareGrantName(
  runtime: Parameters<typeof createRuntimeCurrentSharePrincipalPolicy>[0],
  share: Parameters<typeof shareRemoteContainerWithGroup>[0],
  context: RuntimeCurrentGroupMutationContext,
  expectedName: string,
) {
  const mismatch = await groupPolicyNameMismatch(
    context.currentPolicy,
    expectedName,
    createRuntimeGroupMetadataAccess(
      runtime,
      share.author.organizationId,
      context.stillCurrent,
      context.verifyMetadataContainer,
    ).readName,
  );
  if (mismatch)
    throw new GroupShareNameMismatchError(
      "Container share group name does not match the signed group policy",
    );
  assertProjectionVerificationCurrent(context.stillCurrent);
}

function prepareCurrentShareGrantBatch(
  share: Parameters<typeof shareRemoteContainerWithGroup>[0],
  context: RuntimeCurrentGroupMutationContext,
  nextPolicy: Parameters<
    typeof preparePrincipalContainerRematerializationBatch
  >[0]["nextPolicy"],
  recitationStillCurrent?: () => boolean,
) {
  return preparePrincipalContainerRematerializationBatch({
    ...share,
    grants: [
      ...new Map(
        [...context.currentPolicy.currentGrants, ...nextPolicy.grants].map(
          (grant) => [grant.containerId, grant] as const,
        ),
      ).values(),
    ],
    groupId: share.recipientGroupId,
    nextPolicy,
    resolveAuthoredPolicyReferences: context.resolveAuthoredPolicyReferences,
    stillCurrent: context.stillCurrent,
    recitationStillCurrent,
  });
}
