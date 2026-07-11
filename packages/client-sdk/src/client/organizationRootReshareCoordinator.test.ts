import { expect, mock, test } from "bun:test";
import type { ContainerContents } from "./containerContents";
import {
  createOrganizationRootReshareCoordinator,
  type LoadOrganizationDirectoryForRootReshare,
  type PrepareOrganizationRootRewrapToAdmins,
  type ReshareOrganizationRootToAdmins,
} from "./organizationRootReshareCoordinator";

const CONTAINER_CONTENTS = {} as ContainerContents;

function createHarness(input?: {
  directory?: LoadOrganizationDirectoryForRootReshare;
  prepare?: PrepareOrganizationRootRewrapToAdmins;
  reshare?: ReshareOrganizationRootToAdmins;
  scheduleRetry?: (retry: () => Promise<void>) => void;
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
  const prepare =
    input?.prepare ??
    (mock(async () => ({
      rewrap,
    })) as unknown as PrepareOrganizationRootRewrapToAdmins);
  const coordinator = createOrganizationRootReshareCoordinator({
    containerContents: CONTAINER_CONTENTS,
    loadDirectory,
    prepare,
    reshare,
    scheduleRetry: input?.scheduleRetry,
  });

  return { coordinator, loadDirectory, prepare, reshare, rewrap };
}

test("repairs and prepares root when the Admins group changed", async () => {
  const { coordinator, prepare, reshare, rewrap } = createHarness();

  const prepared = await coordinator.prepareIfAdminsGroup({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });
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
