import {
  nullOnProjectionVerificationCancellation,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import {
  buildMaterializedContainerSharePlan,
  resolveShareProjection,
  submitAcknowledgedContainerMutation,
  submitPlainContainerMutation,
} from "../../containers";
import { createRuntimeCurrentGroupMutation } from "../principalMutations/runtimeCurrentGroupMutation";
import { commitCurrentShareGrant } from "./currentShareGrantMutation";
import { createRuntimeCurrentSharePrincipalPolicy } from "./currentSharePrincipalPolicy";
import { shareWithGroupReplanningOnce } from "./groupShareReplan";
import type { shareRemoteContainerWithGroup } from "./shareWithGroup";

/** Current evidence covers planning, any compound grant mint, and acknowledgement. */
export function createRuntimeCurrentGroupShare(
  runtime: Parameters<typeof createRuntimeCurrentSharePrincipalPolicy>[0],
): typeof shareRemoteContainerWithGroup | undefined {
  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(runtime);
  const api = runtime.apiClient;
  if (!readCurrent) return undefined;
  // The derived runtime keeps this snapshot's policy service and its lease.
  const mutate = createRuntimeCurrentGroupMutation({
    ...runtime,
    apiClient: {
      recoverPendingPrincipalMutation: async (organizationId: string) => {
        // Built-in clients supply journal recovery; standalone hosts retain
        // responsibility for transport and exact-outcome recovery.
        await api.recoverPendingPrincipalMutation?.(organizationId);
      },
    },
  });
  if (!mutate) throw new Error("Current group mutation custody is unavailable");
  const shareOnce = async (
    input: Parameters<typeof shareRemoteContainerWithGroup>[0],
  ) => {
    if (input.stillCurrent?.() === false) return null;
    const recitationStillCurrent = input.stillCurrent ?? (() => true);
    return nullOnProjectionVerificationCancellation(() =>
      readCurrent(
        {
          expectedGroupName: input.expectedGroupName ?? undefined,
          groupId: input.recipientGroupId,
          organizationId: input.author.organizationId,
          stillCurrent: input.stillCurrent ?? (() => true),
        },
        async ({ policy, checkpointPolicies, stillCurrent }) => {
          const share = { ...input, stillCurrent };
          const resolveProjectionUserKey = requireProjectionUserKeyResolver(
            input.resolveProjectionUserKey,
            "Remote container share",
          );
          const previousProjection = await resolveShareProjection(
            share,
            resolveProjectionUserKey,
          );
          if (!previousProjection) return null;
          const grant = policy.grants.find(
            (candidate) => candidate.containerId === input.containerId,
          );
          if (!grant || grant.accessLevel !== input.accessLevel)
            return commitCurrentShareGrant({
              runtime,
              share,
              mutate,
              recitationStillCurrent,
            });
          const materialized = await buildMaterializedContainerSharePlan({
            ...share,
            previousProjection,
            principalPolicyCache:
              principalPolicyCacheForVerifiedPolicies(checkpointPolicies),
            recipient: {
              principalPolicy: policy,
              subjectId: input.recipientGroupId,
              subjectType: "group",
            },
            resolveProjectionUserKey,
          });
          return submitAcknowledgedContainerMutation({
            ...share,
            recitationPolicies: checkpointPolicies,
            recitationStillCurrent,
            containerKey: materialized.containerKey,
            plan: materialized.plan,
            submit: () =>
              submitPlainContainerMutation(() =>
                input.apiClient.shareContainer(
                  input.containerId,
                  materialized.plan.request,
                  {
                    expectedPaymentRequiredOrganizationId:
                      input.author.organizationId,
                    stillCurrent: share.stillCurrent,
                  },
                ),
              ),
          });
        },
      ),
    );
  };
  return (input) => shareWithGroupReplanningOnce(input, shareOnce);
}
