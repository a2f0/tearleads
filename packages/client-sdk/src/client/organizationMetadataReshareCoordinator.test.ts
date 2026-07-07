import { expect, mock, test } from "bun:test";
import type { ContainerContents } from "./containerContents";
import {
  createOrganizationMetadataReshareCoordinator,
  type LoadOrganizationDirectoryForReshare,
  type ReshareOrganizationMetadataToMembers,
} from "./organizationMetadataReshareCoordinator";

// The coordinator only forwards `containerContents` to the (injected) reshare,
// so tests never touch it — a bare cast stands in for the facade.
const CONTAINER_CONTENTS = {} as ContainerContents;

function createHarness(input?: {
  directory?: LoadOrganizationDirectoryForReshare;
  reshare?: ReshareOrganizationMetadataToMembers;
}) {
  const logs: string[] = [];
  const loadDirectory =
    input?.directory ??
    (mock(async () => ({
      memberGroupId: "members-group",
    })) as unknown as LoadOrganizationDirectoryForReshare);
  const reshare =
    input?.reshare ??
    (mock(
      async () => undefined,
    ) as unknown as ReshareOrganizationMetadataToMembers);
  const coordinator = createOrganizationMetadataReshareCoordinator({
    containerContents: CONTAINER_CONTENTS,
    loadDirectory,
    log: (message) => logs.push(message),
    reshare,
  });
  return { coordinator, loadDirectory, logs, reshare };
}

test("re-shares when the mutated group is the Members group", async () => {
  const { coordinator, reshare } = createHarness();

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledTimes(1);
  expect(reshare).toHaveBeenCalledWith({
    containerContents: CONTAINER_CONTENTS,
    log: expect.any(Function),
    memberGroupId: "members-group",
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
});

test("does not re-share when a non-Members group changed", async () => {
  const { coordinator, reshare } = createHarness();

  // e.g. an Admins-group change: it must never touch the org metadata container.
  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "admins-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledTimes(0);
});

test("does not re-share when the org has no Members group", async () => {
  const loadDirectory = mock(async () => ({
    memberGroupId: null,
  })) as unknown as LoadOrganizationDirectoryForReshare;
  const { coordinator, reshare } = createHarness({ directory: loadDirectory });

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledTimes(0);
});

test("caches the Members group id across mutations (single directory lookup)", async () => {
  const loadDirectory = mock(async () => ({ memberGroupId: "members-group" }));
  const { coordinator, reshare } = createHarness({
    directory: loadDirectory as unknown as LoadOrganizationDirectoryForReshare,
  });

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  // The Members group id is immutable, so the directory is fetched once and
  // reused; both changes still re-share.
  expect(loadDirectory).toHaveBeenCalledTimes(1);
  expect(reshare).toHaveBeenCalledTimes(2);
});

test("does not cache a failed lookup, so a later attempt retries", async () => {
  let call = 0;
  const loadDirectory = mock(async () => {
    call += 1;
    // First lookup finds no Members group (e.g. directory not yet synced); the
    // second finds it.
    return call === 1
      ? { memberGroupId: null }
      : { memberGroupId: "members-group" };
  });
  const { coordinator, reshare } = createHarness({
    directory: loadDirectory as unknown as LoadOrganizationDirectoryForReshare,
  });

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  expect(reshare).toHaveBeenCalledTimes(0);

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  expect(loadDirectory).toHaveBeenCalledTimes(2);
  expect(reshare).toHaveBeenCalledTimes(1);
});

test("swallows and logs a re-share failure (best-effort, never throws)", async () => {
  const reshare = mock(async () => {
    throw new Error("share failed");
  }) as unknown as ReshareOrganizationMetadataToMembers;
  const { coordinator, logs } = createHarness({ reshare });

  // Must resolve, not reject — the triggering mutation already committed.
  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("org-1");
  expect(logs[0]).toContain("share failed");
});

test("swallows and logs a directory-lookup failure", async () => {
  const loadDirectory = mock(async () => {
    throw new Error("directory unavailable");
  }) as unknown as LoadOrganizationDirectoryForReshare;
  const { coordinator, logs, reshare } = createHarness({
    directory: loadDirectory,
  });

  await coordinator.reshareAfterGroupChange({
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledTimes(0);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("directory unavailable");
});
