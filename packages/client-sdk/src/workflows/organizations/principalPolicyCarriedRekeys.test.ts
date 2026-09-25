import { expect, test } from "bun:test";
import { createMockRequestFailure } from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { readTestGroupName } from "../../../test/helpers/groupMetadata";
import {
  stubRekeyRequest as carriedRequest,
  createRemovalFixture,
  echoMutation as echo,
  mutationObjectIds,
} from "../../../test/helpers/groupRemovalCarryFixture";
import { policyBundleAfterMutation } from "../../../test/helpers/principalPolicyFixtures";
import { removeOrganizationGroupUser } from "./principalPolicy";

// #2340 finding 1. A group membership change rematerializes the group's
// granted containers, and a rekey among them is a rotation like any other: the
// server refuses one that strands a level above a directly granted container,
// naming the descendant rekeys the batch must carry. The commit answers that
// once with the batch re-signed around them, and acknowledges the whole.

test("a refused group commit is retried once carrying the named rekeys", async () => {
  const fixture = await createRemovalFixture();
  const submissions: Array<readonly string[]> = [];
  const carried = ["carried-upper", "carried-lower"];
  const acknowledged: unknown[][] = [];
  try {
    const apiClient: Parameters<
      typeof removeOrganizationGroupUser
    >[0]["apiClient"] = {
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          return fixture.getOrganizationPolicy();
        }
        return principalId === fixture.adminGroupId
          ? fixture.adminPolicy
          : fixture.getCurrentPolicy();
      },
      commitOrganizationGroupPolicy: async () => {
        throw new Error("The status-bearing variant is preferred");
      },
      commitOrganizationGroupPolicyResult: async (
        _organizationId,
        _groupId,
        input,
      ) => {
        const ids = mutationObjectIds(input.groupPolicy.containerMutations);
        submissions.push(ids);
        if (!carried.every((id) => ids.includes(id))) {
          return createMockRequestFailure({
            code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
            message: "Container rotation must carry its descendant rekeys",
            requiredContainerIds: carried,
            status: 409,
          });
        }
        const nextGroup = await policyBundleAfterMutation({
          mutation: input.groupPolicy,
          previous: fixture.getCurrentPolicy(),
        });
        const nextOrganization = await policyBundleAfterMutation({
          mutation: input.organizationPolicy,
          previous: fixture.getOrganizationPolicy(),
        });
        fixture.setCurrentPolicy(nextGroup);
        fixture.setOrganizationPolicy(nextOrganization);
        return {
          data: {
            groupPolicy: {
              ...nextGroup,
              containerMutations: (
                input.groupPolicy.containerMutations ?? []
              ).map(echo) as never,
            },
            organizationPolicy: { ...nextOrganization, containerMutations: [] },
          },
          ok: true,
        };
      },
    };
    await removeOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => undefined,
      execSql: fixture.execSql,
      expectedGroupName: "Operators",
      readEncryptedName: readTestGroupName,
      groupId: fixture.groupId,
      organizationId: fixture.organizationId,
      prepareContainerMutations: async () => ({
        retiredContainerIds: [],
        acknowledge: async (responses) => {
          acknowledged.push([...responses]);
        },
        carry: async (requiredContainerIds) => {
          expect(requiredContainerIds).toEqual(carried);
          // The whole batch, parent-first, as the prepared batch re-signs it.
          return ["rematerialized", ...requiredContainerIds].map(
            carriedRequest,
          );
        },
        requests: [carriedRequest("rematerialized")],
      }),
      removedUserId: fixture.removedUserId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      signerUserId: fixture.signerUserId,
      signingFingerprint: fixture.signingFingerprint,
      signingKeyPair: fixture.signingKeyPair,
    });
    // Refused once, then resubmitted as the batch `carry` returned, and every
    // response handed to the batch.
    expect(submissions).toEqual([
      ["rematerialized"],
      ["rematerialized", ...carried],
    ]);
    expect(
      acknowledged.map((responses) =>
        responses.map((response) =>
          Reflect.get(Object(response), "containerId"),
        ),
      ),
    ).toEqual([["rematerialized", ...carried]]);
  } finally {
    fixture.close();
  }
});
