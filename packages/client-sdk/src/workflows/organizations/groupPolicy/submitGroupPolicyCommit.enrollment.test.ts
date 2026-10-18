import { expect, mock, test } from "bun:test";
import { createMockRequestFailure } from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { principalMutationJournalFixture } from "../../../../test/helpers/principalMutationJournalFixture";
import { submitGroupPolicyCommit } from "./submitGroupPolicyCommit";

test("compound enrollment reports required key repair without splitting the write", async () => {
  const f = await principalMutationJournalFixture(true);
  const submit = mock(async () =>
    createMockRequestFailure({
      status: 409,
      message: "Container rotation must carry its descendant rekeys",
      code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
      requiredContainerIds: [crypto.randomUUID()],
    }),
  );
  await expect(
    submitGroupPolicyCommit({
      apiClient: {
        getCurrentPrincipalPolicy: async () => null,
        commitOrganizationGroupPolicy: async () => null,
        commitOrganizationGroupPolicyResult: submit,
      },
      organizationId: f.scope.organizationId,
      groupId: f.mutation.groupId,
      request: f.mutation.request.groupPolicy,
      organizationRequest: f.mutation.request.organizationPolicy,
      memberRequest: f.mutation.request.memberPolicy,
    }),
  ).rejects.toThrow(
    "Repair the affected container keys before retrying enrollment; no memberships were changed",
  );
  expect(submit).toHaveBeenCalledTimes(1);
});
