import { expect, test } from "bun:test";
import { createMockRequestFailure } from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createRemovalFixture,
  echoMutation,
  mutationObjectIds,
  stubRekeyRequest,
} from "../../../test/helpers/groupRemovalCarryFixture";
import { createAuthorityRecoveryFixture } from "../../../test/helpers/principalAuthorityRecovery";
import { policyBundleAfterMutation } from "../../../test/helpers/principalPolicyFixtures";
import { principalGrantRetirements } from "../../data/sqlite/principalGrantRetirementSchema";
import { commitCurrentGroupPolicyMutation } from "./commitCurrentGroupPolicyMutation";
import { buildRemoveGroupUserPolicyRequest } from "./groupPolicyRequests";
import { createRuntimeCurrentGroupMutation } from "./runtimeCurrentGroupMutation";

test("current commit retains the carried batch and its post-carry retirements before acknowledgement", async () => {
  const beforeCarry = crypto.randomUUID();
  const afterCarry = crypto.randomUUID();
  const fixture = await createRemovalFixture({
    grantedContainerIds: [beforeCarry, afterCarry],
  });
  const f = await createAuthorityRecoveryFixture({
    directory: fixture.getOrganizationPolicy(),
    admin: fixture.adminPolicy,
    group: fixture.getCurrentPolicy(),
    organizationId: fixture.organizationId,
    resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
  });
  const submissions: string[][] = [];
  const carried = ["carried-upper", "carried-lower"];
  let retirements = [beforeCarry];
  let acknowledged = false;
  const apiClient = f.options.apiClient;
  apiClient.commitOrganizationGroupPolicyResult = async (
    _org,
    _group,
    request,
  ) => {
    const ids = mutationObjectIds(request.groupPolicy.containerMutations);
    submissions.push(ids);
    if (submissions.length === 1)
      return createMockRequestFailure({
        status: 409,
        message: "Container rotation must carry its descendant rekeys",
        code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
        requiredContainerIds: carried,
      });
    return {
      ok: true,
      data: {
        groupPolicy: {
          ...(await policyBundleAfterMutation({
            previous: fixture.getCurrentPolicy(),
            mutation: request.groupPolicy,
          })),
          containerMutations: (
            request.groupPolicy.containerMutations ?? []
          ).map(echoMutation) as never,
        },
        organizationPolicy: await policyBundleAfterMutation({
          previous: fixture.getOrganizationPolicy(),
          mutation: request.organizationPolicy,
        }),
      },
    };
  };
  const mutate = createRuntimeCurrentGroupMutation({
    apiClient: {
      getPrincipalPolicyPages:
        apiClient.getPrincipalPolicyPages.bind(apiClient),
      recoverPendingPrincipalMutation: async () => {},
    },
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) =>
      work({
        protection: f.options.protection,
        stillCurrent: () => true,
      }),
  });
  try {
    if (!mutate) throw new Error("Missing current mutation runtime");
    const remaining = await fixture.resolveTrustedUserIdentity(
      fixture.signerUserId,
    );
    if (!remaining) throw new Error("Missing remaining member");
    const response = await mutate(
      { ...fixture, stillCurrent: () => true },
      async (context) => {
        const request = await buildRemoveGroupUserPolicyRequest({
          ...context,
          signerUserId: fixture.signerUserId,
          signingFingerprint: fixture.signingFingerprint,
          signingKeyPair: fixture.signingKeyPair,
          remainingUsers: [remaining],
          removedUserId: fixture.removedUserId,
        });
        return commitCurrentGroupPolicyMutation({
          ...fixture,
          apiClient,
          context,
          request,
          prepareContainerMutations: async () => ({
            plans: [],
            requests: [stubRekeyRequest("rematerialized")],
            get retiredContainerIds() {
              return retirements;
            },
            carry: async (required) => {
              expect(required).toEqual(carried);
              retirements = [afterCarry];
              return ["rematerialized", ...required].map(stubRekeyRequest);
            },
            acknowledge: async (responses) => {
              expect(responses.map((entry) => entry.containerId)).toEqual([
                "rematerialized",
                ...carried,
              ]);
              expect(
                await f.db.select().from(principalGrantRetirements),
              ).toMatchObject([
                {
                  containerId: afterCarry,
                  organizationId: fixture.organizationId,
                },
              ]);
              acknowledged = true;
            },
          }),
        });
      },
    );
    expect(submissions).toEqual([
      ["rematerialized"],
      ["rematerialized", ...carried],
    ]);
    expect(acknowledged).toBe(true);
    expect(await f.db.select().from(principalGrantRetirements)).toEqual([
      {
        containerId: afterCarry,
        organizationId: fixture.organizationId,
        principalId: fixture.groupId,
        policyStateHash: response.currentState.stateHash,
      },
    ]);
  } finally {
    f.close();
    fixture.close();
  }
}, 15_000);
