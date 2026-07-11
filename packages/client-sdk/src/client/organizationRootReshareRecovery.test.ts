import { expect, test } from "bun:test";
import { recoverOrganizationRootRewrapAfterMutationFailure } from "./organizationRootReshare";

test("does not reconcile a successful group mutation", async () => {
  let rewrapCalls = 0;

  const result = await recoverOrganizationRootRewrapAfterMutationFailure({
    logError: () => undefined,
    mutation: Promise.resolve("committed"),
    prepared: {
      hasExpectedGroupPolicyHead: () => false,
      rewrap: async () => {
        rewrapCalls += 1;
      },
      setExpectedGroupPolicyHead: () => undefined,
    },
  });

  expect(result).toBe("committed");
  expect(rewrapCalls).toBe(0);
});

test("reconciles a prepared root re-wrap after an ambiguous mutation failure", async () => {
  let rewrapCalls = 0;
  const mutationError = new Error("group mutation failed");

  await expect(
    recoverOrganizationRootRewrapAfterMutationFailure({
      logError: () => undefined,
      mutation: Promise.reject(mutationError),
      prepared: {
        hasExpectedGroupPolicyHead: () => true,
        rewrap: async () => {
          rewrapCalls += 1;
        },
        setExpectedGroupPolicyHead: () => undefined,
      },
    }),
  ).rejects.toThrow("group mutation failed");

  expect(rewrapCalls).toBe(1);
});

test("skips recovery when failure precedes the policy-head binding", async () => {
  let rewrapCalls = 0;

  await expect(
    recoverOrganizationRootRewrapAfterMutationFailure({
      logError: () => undefined,
      mutation: Promise.reject(new Error("policy build failed")),
      prepared: {
        hasExpectedGroupPolicyHead: () => false,
        rewrap: async () => {
          rewrapCalls += 1;
        },
        setExpectedGroupPolicyHead: () => undefined,
      },
    }),
  ).rejects.toThrow("policy build failed");

  expect(rewrapCalls).toBe(0);
});

test("preserves the mutation error when reconciliation also fails", async () => {
  const logged: Array<{ cause?: unknown; message: string | Error }> = [];
  const rewrapError = new Error("root re-wrap failed");

  await expect(
    recoverOrganizationRootRewrapAfterMutationFailure({
      logError: (message, cause) => {
        logged.push({ cause, message });
        throw new Error("logger failed");
      },
      mutation: Promise.reject(new Error("group mutation failed")),
      prepared: {
        hasExpectedGroupPolicyHead: () => true,
        rewrap: async () => {
          throw rewrapError;
        },
        setExpectedGroupPolicyHead: () => undefined,
      },
    }),
  ).rejects.toThrow("group mutation failed");

  expect(logged).toEqual([
    {
      cause: rewrapError,
      message:
        "Organization root re-wrap reconciliation failed after a group mutation error",
    },
  ]);
});
