import {
  nullOnProjectionVerificationCancellation,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { inheritPrincipalHistoryProtection } from "../../../data/principals/principalHistoryRuntime";
import { createRuntimeCurrentGroupMutation } from "../../organizations/runtimeCurrentGroupMutation";
import { commitCurrentShareGrant } from "./currentShareGrantMutation";
import { createRuntimeCurrentSharePrincipalPolicy } from "./currentSharePrincipalPolicy";
import {
  submitAcknowledgedContainerMutation,
  submitPlainContainerMutation,
} from "./mutationSubmit";
import type { shareRemoteContainerWithGroup } from "./share";
import { buildMaterializedContainerSharePlan } from "./shareMaterialization";
import { resolveShareProjection } from "./shareProjection";

/** Current evidence covers planning, any compound grant mint, and acknowledgement. */
export function createRuntimeCurrentGroupShare(
  runtime: Parameters<typeof createRuntimeCurrentSharePrincipalPolicy>[0],
): typeof shareRemoteContainerWithGroup | undefined {
  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(runtime);
  const api = runtime.apiClient;
  const readPages = api.getPrincipalPolicyPages;
  if (!readCurrent || !readPages) return undefined;
  const mutate = createRuntimeCurrentGroupMutation(
    inheritPrincipalHistoryProtection(runtime, {
      ...runtime,
      apiClient: {
        getPrincipalPolicyPages: readPages.bind(api),
        ...(api.getProjectionPolicyHistoryPages
          ? {
              getProjectionPolicyHistoryPages:
                api.getProjectionPolicyHistoryPages.bind(api),
            }
          : {}),
        recoverPendingPrincipalMutation: async (organizationId: string) => {
          // Built-in clients supply journal recovery; standalone hosts retain
          // responsibility for transport and exact-outcome recovery.
          await api.recoverPendingPrincipalMutation?.(organizationId);
        },
      },
    }),
  );
  if (!mutate) throw new Error("Current group mutation custody is unavailable");
  return async (input) => {
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
                  },
                ),
              ),
          });
        },
      ),
    );
  };
}
