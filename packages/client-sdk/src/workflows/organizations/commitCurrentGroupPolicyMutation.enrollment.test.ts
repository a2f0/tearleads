import { expect, mock, test } from "bun:test";
import { createRemovalFixture } from "../../../test/helpers/groupRemovalCarryFixture";
import { createAuthorityRecoveryFixture } from "../../../test/helpers/principalAuthorityRecovery";
import { commitCurrentGroupPolicyMutation } from "./commitCurrentGroupPolicyMutation";
import { buildRemoveGroupUserPolicyRequest } from "./groupPolicyRequests";
import { createRuntimeCurrentGroupMutation } from "./runtimeCurrentGroupMutation";

test.each(["member group", "directory head"] as const)(
  "compound preparation refuses a mismatched %s before dispatch",
  async (mismatch) => {
    const fixture = await createRemovalFixture();
    const f = await createAuthorityRecoveryFixture({
      directory: fixture.getOrganizationPolicy(),
      admin: fixture.adminPolicy,
      group: fixture.getCurrentPolicy(),
      organizationId: fixture.organizationId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    });
    const submit = mock(async () => null);
    const mutate = createRuntimeCurrentGroupMutation({
      apiClient: {
        getPrincipalPolicyPages: f.apiClient.getPrincipalPolicyPages.bind(
          f.apiClient,
        ),
        recoverPendingPrincipalMutation: async () => {},
      },
      infra: { execSql: f.options.execSql },
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      util: { reportSecurityIncident: async () => {} },
      withPrincipalHistoryProtection: async (work) =>
        work({ protection: f.options.protection, stillCurrent: () => true }),
    });
    try {
      if (!mutate) throw new Error("Missing mutation runtime");
      const signer = await fixture.resolveTrustedUserIdentity(
        fixture.signerUserId,
      );
      if (!signer) throw new Error("Missing signer");
      await expect(
        mutate({ ...fixture, stillCurrent: () => true }, async (context) => {
          // Both successors pass real signature/history verification. Only the
          // relationship between the two loaded contexts is inconsistent.
          const request = await buildRemoveGroupUserPolicyRequest({
            ...context,
            ...fixture,
            remainingUsers: [signer],
          });
          const prepareContainerMutations = async () => ({
            plans: [],
            requests: [],
            retiredContainerIds: [],
            carry: async () => [],
            acknowledge: async () => {},
          });
          const memberContext = {
            ...context,
            organizationCurrent: {
              ...context.organizationCurrent,
              current: {
                ...context.organizationCurrent.current,
                currentState: {
                  ...context.organizationCurrent.current.currentState,
                  stateHash:
                    mismatch === "directory head"
                      ? context.currentPolicy.currentState.stateHash
                      : context.organizationCurrent.current.currentState
                          .stateHash,
                },
              },
            },
          };
          return commitCurrentGroupPolicyMutation({
            ...fixture,
            apiClient: {
              getCurrentPrincipalPolicy: async () => null,
              commitOrganizationGroupPolicy: submit,
            },
            context: {
              ...context,
              memberGroupId:
                mismatch === "directory head"
                  ? fixture.groupId
                  : context.memberGroupId,
            },
            request,
            prepareContainerMutations,
            member: {
              context: memberContext,
              request: structuredClone(request),
              prepareContainerMutations,
            },
          });
        }),
      ).rejects.toThrow(
        "Roster and group changes must share the same organization policy",
      );
      expect(submit).not.toHaveBeenCalled();
    } finally {
      f.close();
      fixture.close();
    }
  },
);
