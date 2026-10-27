import { expect, mock, test } from "bun:test";
import { createMockRequestFailure } from "@tearleads/test-utils";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { stubRekeyRequest } from "../../../../test/helpers/groupRemovalCarryFixture";
import { principalMutationJournalFixture } from "../../../../test/helpers/principalMutationJournalFixture";
import { submitGroupPolicyCommit } from "./submitGroupPolicyCommit";

type Input = Parameters<typeof submitGroupPolicyCommit>[0];
const stale = () =>
  createMockRequestFailure({
    status: 409,
    code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
    message: "Container head changed",
  });

async function fixture(includeEnrollment = false) {
  const f = await principalMutationJournalFixture(includeEnrollment);
  const snapshots: unknown[] = [];
  const report = mock(() => {});
  let current = true;
  let failure = { ...stale(), report };
  const refresh = mock(async () => [stubRekeyRequest("fresh")]);
  const submit = mock(
    async (
      _org: string,
      _group: string,
      request: CommitOrganizationGroupPolicyRequest,
    ) => {
      snapshots.push(structuredClone(request));
      return snapshots.length === 1
        ? failure
        : { ok: true as const, data: f.response };
    },
  );
  const input: Input = {
    apiClient: {
      getCurrentPrincipalPolicy: async () => null,
      commitOrganizationGroupPolicy: async () => null,
      commitOrganizationGroupPolicyResult: submit,
    },
    organizationId: f.scope.organizationId,
    groupId: f.mutation.groupId,
    request: {
      ...f.mutation.request.groupPolicy,
      containerMutations: [stubRekeyRequest("stale")],
    },
    organizationRequest: f.mutation.request.organizationPolicy,
    memberRequest: f.mutation.request.memberPolicy,
    refreshContainerMutations: refresh,
    stillCurrent: () => current,
  };
  return {
    f,
    input,
    snapshots,
    report,
    refresh,
    submit,
    cancel: () => {
      current = false;
    },
    refuse: (value: typeof failure) => {
      failure = value;
    },
  };
}

test("a stale container refusal replaces only the container batch and submits once more", async () => {
  const f = await fixture();
  expect(await submitGroupPolicyCommit(f.input)).toEqual(f.f.response);
  expect(f.snapshots).toEqual([
    {
      ...f.f.mutation.request,
      groupPolicy: {
        ...f.f.mutation.request.groupPolicy,
        containerMutations: [stubRekeyRequest("stale")],
      },
    },
    {
      ...f.f.mutation.request,
      groupPolicy: {
        ...f.f.mutation.request.groupPolicy,
        containerMutations: [stubRekeyRequest("fresh")],
      },
    },
  ]);
  expect(f.refresh).toHaveBeenCalledTimes(1);
  expect(f.report).not.toHaveBeenCalled();
});

for (const [status, code] of [
  [409, undefined],
  [403, CONTAINER_MUTATION_ERROR_CODES.stateStale],
  [400, CONTAINER_MUTATION_ERROR_CODES.stateStale],
  [409, "principal_policy_stale"],
] as const) {
  test(`policy refusal ${status}/${code} does not replan`, async () => {
    const f = await fixture();
    f.refuse({
      ...createMockRequestFailure({ status, code, message: "Refused" }),
      report: f.report,
    });
    expect(await submitGroupPolicyCommit(f.input)).toBeNull();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledTimes(1);
  });
}

test("a second stale refusal is terminal and reports only that refusal", async () => {
  const f = await fixture();
  const secondReport = mock(() => {});
  f.submit.mockImplementationOnce(async () => ({
    ...stale(),
    report: f.report,
  }));
  f.submit.mockImplementation(async () => ({
    ...stale(),
    report: secondReport,
  }));
  expect(await submitGroupPolicyCommit(f.input)).toBeNull();
  expect(f.submit).toHaveBeenCalledTimes(2);
  expect(f.refresh).toHaveBeenCalledTimes(1);
  expect(f.report).not.toHaveBeenCalled();
  expect(secondReport).toHaveBeenCalledTimes(1);
});

for (const stage of ["first", "retry"] as const) {
  for (const kind of ["cancelled", "outcome-unknown"] as const) {
    test(`${kind} on ${stage} submission cannot start another plan`, async () => {
      const f = await fixture();
      f.submit.mockImplementation(async () => ({
        ...stale(),
        kind,
        status: null,
        message: "Uncertain",
        report: f.report,
      }));
      if (stage === "retry")
        f.submit.mockImplementationOnce(async () => ({
          ...stale(),
          report: f.report,
        }));
      const result = submitGroupPolicyCommit(f.input);
      if (kind === "outcome-unknown")
        await expect(result).rejects.toThrow("Uncertain");
      else expect(await result).toBeNull();
      expect(f.submit).toHaveBeenCalledTimes(stage === "first" ? 1 : 2);
      expect(f.refresh).toHaveBeenCalledTimes(stage === "first" ? 0 : 1);
      expect(f.report).not.toHaveBeenCalled();
    });
  }
}

test("a cancelled generation cannot submit its rebuilt batch", async () => {
  const f = await fixture();
  f.refresh.mockImplementation(async () => {
    f.cancel();
    return [stubRekeyRequest("fresh")];
  });
  expect(await submitGroupPolicyCommit(f.input)).toBeNull();
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(f.report).not.toHaveBeenCalled();
});

test("compound enrollment refuses atomically instead of reusing shared speculative paths", async () => {
  const f = await fixture(true);
  expect(await submitGroupPolicyCommit(f.input)).toBeNull();
  expect(f.submit).toHaveBeenCalledTimes(1);
  expect(f.refresh).not.toHaveBeenCalled();
});
