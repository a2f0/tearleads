import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
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

test("propagates a mutation integrity failure without reconciliation", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted group identity changed",
  );
  let rewrapCalls = 0;
  let logCalls = 0;

  await expect(
    recoverOrganizationRootRewrapAfterMutationFailure({
      logError: () => {
        logCalls += 1;
      },
      mutation: Promise.reject(integrityError),
      prepared: {
        hasExpectedGroupPolicyHead: () => true,
        rewrap: async () => {
          rewrapCalls += 1;
        },
        setExpectedGroupPolicyHead: () => undefined,
      },
    }),
  ).rejects.toBe(integrityError);

  expect(rewrapCalls).toBe(0);
  expect(logCalls).toBe(0);
});

test("does not hide a reconciliation integrity failure behind a mutation error", async () => {
  const integrityError = new KeyingVerificationError(
    "signature_mismatch",
    "root projection signature changed",
  );
  let logCalls = 0;

  await expect(
    recoverOrganizationRootRewrapAfterMutationFailure({
      logError: () => {
        logCalls += 1;
      },
      mutation: Promise.reject(new Error("ambiguous mutation response")),
      prepared: {
        hasExpectedGroupPolicyHead: () => true,
        rewrap: async () => {
          throw integrityError;
        },
        setExpectedGroupPolicyHead: () => undefined,
      },
    }),
  ).rejects.toBe(integrityError);

  expect(logCalls).toBe(0);
});
