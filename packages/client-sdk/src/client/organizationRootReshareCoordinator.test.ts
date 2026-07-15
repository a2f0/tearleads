import { expect, mock, test } from "bun:test";
import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import {
  createOrganizationRootReshareCoordinator,
  type LoadOrganizationDirectoryForRootReshare,
  type PrepareOrganizationRootRewrapToAdmins,
  type ReshareOrganizationRootToAdmins,
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
  directory?: LoadOrganizationDirectoryForRootReshare;
  logError?: (message: string | Error, cause?: unknown) => void;
  prepare?: PrepareOrganizationRootRewrapToAdmins;
  reshare?: ReshareOrganizationRootToAdmins;
  scheduleRetry?: (retry: () => Promise<void>, delayMs: number) => void;
}) {
  const loadDirectory =
    input?.directory ??
    (mock(async () => ({
      adminGroupId: "admins-group",
    })) as unknown as LoadOrganizationDirectoryForRootReshare);
  const reshare =
    input?.reshare ??
    (mock(async () => undefined) as unknown as ReshareOrganizationRootToAdmins);
  const rewrap = mock(async () => undefined);
  let hasExpectedGroupPolicyHead = false;
  const setExpectedGroupPolicyHead = mock(
    (_head: ReferencedPrincipalHead) => undefined,
  );
  const prepare =
    input?.prepare ??
    (mock(async () => ({
      hasExpectedGroupPolicyHead: () => hasExpectedGroupPolicyHead,
      rewrap,
      setExpectedGroupPolicyHead: (head: ReferencedPrincipalHead) => {
        hasExpectedGroupPolicyHead = true;
        setExpectedGroupPolicyHead(head);
      },
    })) as unknown as PrepareOrganizationRootRewrapToAdmins);
  const coordinator = createOrganizationRootReshareCoordinator({
    containerContents: CONTAINER_CONTENTS,
    loadDirectory,
    logError: input?.logError,
    prepare,
    reshare,
    scheduleRetry: input?.scheduleRetry,
  });

  return {
    coordinator,
    loadDirectory,
    prepare,
    reshare,
    rewrap,
    setExpectedGroupPolicyHead,
  };
}

test("repairs and prepares root when the Admins group changed", async () => {
  const { coordinator, prepare, reshare, rewrap, setExpectedGroupPolicyHead } =
    createHarness();

  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(reshare).toHaveBeenCalledWith({
    adminGroupId: "admins-group",
    containerContents: CONTAINER_CONTENTS,
    organizationId: "org-1",
  });
  expect(prepare).toHaveBeenCalledWith({
    adminGroupId: "admins-group",
    containerContents: CONTAINER_CONTENTS,
    organizationId: "org-1",
  });
  expect(rewrap).toHaveBeenCalledTimes(1);
  expect(setExpectedGroupPolicyHead).toHaveBeenCalledWith(EXPECTED_GROUP_HEAD);
});

test("returns a no-op when another group changed", async () => {
  const { coordinator, prepare, reshare } = createHarness();

  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await prepared.rewrap();

  expect(reshare).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

test("does not flush a captured key before its post-commit callback", async () => {
  const { coordinator, rewrap } = createHarness();
  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  const unrelated = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await unrelated.rewrap();

  expect(rewrap).not.toHaveBeenCalled();
  await prepared.rewrap();
  expect(rewrap).toHaveBeenCalledTimes(1);
});

test("applies overlapping Admins callbacks instead of overwriting either token", async () => {
  const { coordinator, rewrap } = createHarness();
  const first = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  const second = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  expect(rewrap).not.toHaveBeenCalled();
  await Promise.all([first.rewrap(), second.rewrap()]);
  expect(rewrap).toHaveBeenCalledTimes(2);
});

test("caches a resolved Admins group id", async () => {
  const { coordinator, loadDirectory, reshare } = createHarness();

  await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  expect(loadDirectory).toHaveBeenCalledTimes(1);
  expect(reshare).toHaveBeenCalledTimes(2);
});

test("rejects an unresolved Admins group and retries the lookup", async () => {
  let calls = 0;
  const loadDirectory = mock(async () => {
    calls += 1;
    return { adminGroupId: calls === 1 ? null : "admins-group" };
  }) as unknown as LoadOrganizationDirectoryForRootReshare;
  const { coordinator, reshare } = createHarness({ directory: loadDirectory });

  await expect(
    coordinator.prepareIfAdminsGroup({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toThrow("Admins group could not be resolved");
  await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  expect(loadDirectory).toHaveBeenCalledTimes(2);
  expect(reshare).toHaveBeenCalledTimes(1);
});

test("propagates root re-share failures", async () => {
  const reshare = mock(async () => {
    throw new Error("root re-share failed");
  }) as unknown as ReshareOrganizationRootToAdmins;
  const { coordinator } = createHarness({ reshare });

  await expect(
    coordinator.prepareIfAdminsGroup({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toThrow("root re-share failed");
});

test("retains and schedules a failed prepared re-wrap", async () => {
  let rewrapCalls = 0;
  const scheduled: Array<() => Promise<void>> = [];
  const prepare = mock(async () => ({
    rewrap: async () => {
      rewrapCalls += 1;
      if (rewrapCalls === 1) {
        throw new Error("transient share failure");
      }
    },
  })) as unknown as PrepareOrganizationRootRewrapToAdmins;
  const { coordinator } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  await expect(prepared.rewrap()).rejects.toThrow("transient share failure");
  expect(scheduled).toHaveLength(1);
  expect(rewrapCalls).toBe(1);

  await scheduled[0]?.();
  expect(rewrapCalls).toBe(2);
});

test("does not let a pending re-wrap block an unrelated group mutation", async () => {
  const scheduled: Array<() => Promise<void>> = [];
  const logError = mock(() => {
    throw new Error("logger failed");
  });
  const rewrap = mock(async () => {
    throw new Error("persistent share failure");
  });
  const prepare = mock(async () => ({
    hasExpectedGroupPolicyHead: () => true,
    rewrap,
    setExpectedGroupPolicyHead: () => undefined,
  }));
  const { coordinator, reshare } = createHarness({
    logError,
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const adminsRewrap = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(adminsRewrap.rewrap()).rejects.toThrow(
    "persistent share failure",
  );

  const unrelatedRewrap = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await unrelatedRewrap.rewrap();

  expect(rewrap).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(reshare).toHaveBeenCalledTimes(1);
  expect(scheduled).toHaveLength(1);
  expect(logError).toHaveBeenCalledWith(
    "Failed to re-wrap organization root for org-1; allowing unrelated group mutation",
    expect.any(Error),
  );
});

test("rejects an Admins mutation while a pending re-wrap is failing", async () => {
  const scheduled: Array<() => Promise<void>> = [];
  const rewrap = mock(async () => {
    throw new Error("persistent share failure");
  });
  const prepare = mock(async () => ({
    hasExpectedGroupPolicyHead: () => true,
    rewrap,
    setExpectedGroupPolicyHead: () => undefined,
  }));
  const { coordinator, reshare } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const first = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(first.rewrap()).rejects.toThrow("persistent share failure");

  await expect(
    coordinator.prepareIfAdminsGroup({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toThrow("persistent share failure");

  expect(rewrap).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(reshare).toHaveBeenCalledTimes(1);
  expect(scheduled).toHaveLength(1);
});

test("logs and reschedules background failures with capped backoff", async () => {
  const scheduled: Array<{
    delayMs: number;
    retry: () => Promise<void>;
  }> = [];
  const logError = mock(() => {
    throw new Error("logger failed");
  });
  const prepare = mock(async () => ({
    rewrap: async () => {
      throw new Error("persistent share failure");
    },
  })) as unknown as PrepareOrganizationRootRewrapToAdmins;
  const { coordinator } = createHarness({
    logError,
    prepare,
    scheduleRetry: (retry, delayMs) => scheduled.push({ delayMs, retry }),
  });
  const prepared = await coordinator.prepareIfAdminsGroup({
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
  expect(logError).toHaveBeenLastCalledWith(
    "Failed to re-wrap organization root for org-1; retrying",
    expect.any(Error),
  );
});

test("deduplicates a background retry and a foreground re-wrap", async () => {
  let releaseRetry: () => void = () => {};
  let resolveRetryStarted: () => void = () => {};
  const retryStarted = new Promise<void>((resolve) => {
    resolveRetryStarted = resolve;
  });
  const retryMayFinish = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  let rewrapCalls = 0;
  const scheduled: Array<() => Promise<void>> = [];
  const prepare = mock(async () => ({
    rewrap: async () => {
      rewrapCalls += 1;
      if (rewrapCalls === 1) {
        throw new Error("transient share failure");
      }
      resolveRetryStarted();
      await retryMayFinish;
    },
  })) as unknown as PrepareOrganizationRootRewrapToAdmins;
  const { coordinator } = createHarness({
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await expect(prepared.rewrap()).rejects.toThrow("transient share failure");

  const retry = scheduled[0]?.();
  await retryStarted;
  const foreground = coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  await Promise.resolve();

  expect(rewrapCalls).toBe(2);
  releaseRetry();
  await Promise.all([retry, foreground]);
  expect(rewrapCalls).toBe(2);
});

test("does not schedule a prepared re-wrap integrity failure", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted Admins identity changed",
  );
  const rewrap = mock(async () => {
    throw integrityError;
  });
  const scheduleRetry = mock(() => undefined);
  const logError = mock(() => undefined);
  const prepare = mock(async () => ({
    hasExpectedGroupPolicyHead: () => true,
    rewrap,
    setExpectedGroupPolicyHead: () => undefined,
  }));
  const { coordinator } = createHarness({
    logError,
    prepare,
    scheduleRetry,
  });
  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);

  await expect(prepared.rewrap()).rejects.toBe(integrityError);
  await expect(
    coordinator.prepareIfAdminsGroup({
      mutatedGroupId: "members-group",
      organizationId: "org-1",
    }),
  ).rejects.toBe(integrityError);
  expect(rewrap).toHaveBeenCalledTimes(1);
  expect(scheduleRetry).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
});

test("a retry integrity failure is logged as terminal without rescheduling", async () => {
  const transientError = new Error("transient root re-wrap failure");
  const integrityError = new KeyingVerificationError(
    "signature_mismatch",
    "trusted root signer changed",
  );
  let rewrapCalls = 0;
  const rewrap = mock(async () => {
    rewrapCalls += 1;
    throw rewrapCalls === 1 ? transientError : integrityError;
  });
  const scheduled: Array<() => Promise<void>> = [];
  const logError = mock(() => undefined);
  const prepare = mock(async () => ({
    hasExpectedGroupPolicyHead: () => true,
    rewrap,
    setExpectedGroupPolicyHead: () => undefined,
  }));
  const { coordinator } = createHarness({
    logError,
    prepare,
    scheduleRetry: (retry) => scheduled.push(retry),
  });
  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);

  await expect(prepared.rewrap()).rejects.toBe(transientError);
  expect(scheduled).toHaveLength(1);
  const retry = scheduled[0];
  if (!retry) {
    throw new Error("Expected scheduled root re-wrap retry.");
  }
  await expect(retry()).resolves.toBeUndefined();

  expect(rewrap).toHaveBeenCalledTimes(2);
  expect(scheduled).toHaveLength(1);
  expect(logError).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalledWith(
    "Stopped organization root re-wrap retries for org-1 after an identity verification failure",
    integrityError,
  );
  await expect(
    coordinator.prepareIfAdminsGroup({
      mutatedGroupId: "admins-group",
      organizationId: "org-1",
    }),
  ).rejects.toBe(integrityError);
  expect(rewrap).toHaveBeenCalledTimes(2);
  expect(scheduled).toHaveLength(1);
});
