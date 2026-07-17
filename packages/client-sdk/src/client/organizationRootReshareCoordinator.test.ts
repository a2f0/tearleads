import { expect, mock, test } from "bun:test";
import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import type { PreparedOrganizationRootRewrap } from "./organizationRootReshare";
import {
  createOrganizationRootReshareCoordinator,
  type PrepareOrganizationRootRewrapForGroup,
} from "./organizationRootReshareCoordinator";

const CONTAINER_CONTENTS = {} as ContainerContents;
const EXPECTED_GROUP_HEAD = {
  principalType: "group" as const,
  principalId: "admins-group",
  version: 2,
  keyEpoch: 2,
  stateHash: "expected-admins-state-hash",
  keyFingerprint: "expected-admins-key-fingerprint",
};

function createHarness(input?: {
  logError?: (message: string | Error, cause?: unknown) => void;
  prepare?: PrepareOrganizationRootRewrapForGroup;
  scheduleRetry?: (retry: () => Promise<void>, delayMs: number) => void;
}) {
  const rewrap = mock(async () => undefined);
  let hasExpectedGroupPolicyHead = false;
  const setExpectedGroupPolicyHead = mock(
    (_head: ReferencedPrincipalHead) => undefined,
  );
  const prepare =
    input?.prepare ??
    (mock(async ({ groupId }) =>
      groupId === "admins-group"
        ? {
            hasExpectedGroupPolicyHead: () => hasExpectedGroupPolicyHead,
            rewrap,
            setExpectedGroupPolicyHead: (head: ReferencedPrincipalHead) => {
              hasExpectedGroupPolicyHead = true;
              setExpectedGroupPolicyHead(head);
            },
          }
        : null,
    ) as unknown as PrepareOrganizationRootRewrapForGroup);
  const coordinator = createOrganizationRootReshareCoordinator({
    containerContents: CONTAINER_CONTENTS,
    logError: input?.logError,
    prepare,
    scheduleRetry: input?.scheduleRetry,
  });

  return { coordinator, prepare, rewrap, setExpectedGroupPolicyHead };
}

test("prepares and applies when the signed root grants the mutated group admin", async () => {
  const { coordinator, prepare, rewrap, setExpectedGroupPolicyHead } =
    createHarness();

  const prepared = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(prepare).toHaveBeenCalledWith({
    containerContents: CONTAINER_CONTENTS,
    groupId: "admins-group",
    organizationId: "org-1",
  });
  expect(rewrap).toHaveBeenCalledTimes(1);
  expect(setExpectedGroupPolicyHead).toHaveBeenCalledWith(EXPECTED_GROUP_HEAD);
});

test("a forged read-model Admins id cannot select root keying", async () => {
  const { coordinator, prepare, rewrap } = createHarness();

  const prepared = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "forged-read-model-admins-id",
    organizationId: "org-1",
  });
  prepared.setExpectedGroupPolicyHead({
    ...EXPECTED_GROUP_HEAD,
    principalId: "forged-read-model-admins-id",
  });
  await prepared.rewrap();

  expect(prepare).toHaveBeenCalledWith({
    containerContents: CONTAINER_CONTENTS,
    groupId: "forged-read-model-admins-id",
    organizationId: "org-1",
  });
  expect(prepared.hasExpectedGroupPolicyHead()).toBe(false);
  expect(rewrap).not.toHaveBeenCalled();
});

test("verification or availability failure rejects before policy commit", async () => {
  const integrityError = new KeyingVerificationError(
    "signature_mismatch",
    "root projection signer changed",
  );
  const prepare = mock(async () => {
    throw integrityError;
  }) as unknown as PrepareOrganizationRootRewrapForGroup;
  const { coordinator } = createHarness({ prepare });

  await expect(
    coordinator.prepareForGroupMutation({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toBe(integrityError);
});

test("does not flush a captured key before its post-commit callback", async () => {
  const { coordinator, rewrap } = createHarness();
  const captured = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  const unrelated = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await unrelated.rewrap();
  expect(rewrap).not.toHaveBeenCalled();

  await captured.rewrap();
  expect(rewrap).toHaveBeenCalledTimes(1);
});

test("applies overlapping matching-group callbacks", async () => {
  const { coordinator, rewrap } = createHarness();
  const first = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  const second = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  await Promise.all([first.rewrap(), second.rewrap()]);
  expect(rewrap).toHaveBeenCalledTimes(2);
});

test("retains and schedules a failed prepared re-wrap", async () => {
  let rewrapCalls = 0;
  const scheduled: Array<() => Promise<void>> = [];
  const prepare = mock(
    async (): Promise<PreparedOrganizationRootRewrap> => ({
      hasExpectedGroupPolicyHead: () => true,
      rewrap: async () => {
        rewrapCalls += 1;
        if (rewrapCalls === 1) {
          throw new Error("transient share failure");
        }
      },
      setExpectedGroupPolicyHead: () => undefined,
    }),
  );
  const { coordinator } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const prepared = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  await expect(prepared.rewrap()).rejects.toThrow("transient share failure");
  expect(scheduled).toHaveLength(1);
  await scheduled[0]?.();
  expect(rewrapCalls).toBe(2);
});

test("a pending root failure does not touch an unrelated group", async () => {
  const scheduled: Array<() => Promise<void>> = [];
  const rewrap = mock(async () => {
    throw new Error("persistent share failure");
  });
  const prepare = mock(
    async ({ groupId }): Promise<PreparedOrganizationRootRewrap | null> =>
      groupId === "admins-group"
        ? {
            hasExpectedGroupPolicyHead: () => true,
            rewrap,
            setExpectedGroupPolicyHead: () => undefined,
          }
        : null,
  );
  const { coordinator } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const adminsRewrap = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(adminsRewrap.rewrap()).rejects.toThrow(
    "persistent share failure",
  );

  const unrelated = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await unrelated.rewrap();

  expect(rewrap).toHaveBeenCalledTimes(1);
  expect(scheduled).toHaveLength(1);
});

test("a pending root failure blocks another matching grant mutation", async () => {
  const scheduled: Array<() => Promise<void>> = [];
  const rewrap = mock(async () => {
    throw new Error("persistent share failure");
  });
  const prepare = mock(
    async (): Promise<PreparedOrganizationRootRewrap> => ({
      hasExpectedGroupPolicyHead: () => true,
      rewrap,
      setExpectedGroupPolicyHead: () => undefined,
    }),
  );
  const { coordinator } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const first = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(first.rewrap()).rejects.toThrow("persistent share failure");

  await expect(
    coordinator.prepareForGroupMutation({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toThrow("persistent share failure");
  expect(rewrap).toHaveBeenCalledTimes(2);
  expect(scheduled).toHaveLength(1);
});

test("logs and reschedules background failures with capped backoff", async () => {
  const scheduled: Array<{
    delayMs: number;
    retry: () => Promise<void>;
  }> = [];
  const logError = mock(() => undefined);
  const prepare = mock(
    async (): Promise<PreparedOrganizationRootRewrap> => ({
      hasExpectedGroupPolicyHead: () => true,
      rewrap: async () => {
        throw new Error("persistent share failure");
      },
      setExpectedGroupPolicyHead: () => undefined,
    }),
  );
  const { coordinator } = createHarness({
    logError,
    prepare,
    scheduleRetry: (retry, delayMs) => scheduled.push({ delayMs, retry }),
  });
  const prepared = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(prepared.rewrap()).rejects.toThrow("persistent share failure");

  for (let index = 0; index < 7; index += 1) {
    await scheduled[index]?.retry();
  }
  expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([
    1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
  ]);
  expect(logError).toHaveBeenCalledTimes(7);
});

test("integrity failure is terminal for root-granted groups but not unrelated groups", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted root identity changed",
  );
  const rewrap = mock(async () => {
    throw integrityError;
  });
  const prepare = mock(
    async ({ groupId }): Promise<PreparedOrganizationRootRewrap | null> =>
      groupId === "admins-group"
        ? {
            hasExpectedGroupPolicyHead: () => true,
            rewrap,
            setExpectedGroupPolicyHead: () => undefined,
          }
        : null,
  );
  const scheduleRetry = mock(() => undefined);
  const { coordinator } = createHarness({ prepare, scheduleRetry });
  const prepared = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(prepared.rewrap()).rejects.toBe(integrityError);

  const unrelated = await coordinator.prepareForGroupMutation({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await expect(unrelated.rewrap()).resolves.toBeUndefined();
  await expect(
    coordinator.prepareForGroupMutation({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toBe(integrityError);
  expect(scheduleRetry).not.toHaveBeenCalled();
});
