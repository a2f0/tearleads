import { expect, mock, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import {
  createOrganizationMetadataReshareCoordinator,
  type ReshareOrganizationMetadataAfterGroupChange,
} from "./organizationMetadataReshareCoordinator";

const CONTAINER_CONTENTS = {} as ContainerContents;

function createHarness(input?: {
  reshare?: ReshareOrganizationMetadataAfterGroupChange;
}) {
  const logs: string[] = [];
  const reshare =
    input?.reshare ??
    (mock(
      async () => undefined,
    ) as unknown as ReshareOrganizationMetadataAfterGroupChange);
  const coordinator = createOrganizationMetadataReshareCoordinator({
    containerContents: CONTAINER_CONTENTS,
    log: (message) => logs.push(message),
    reshare,
  });
  return { coordinator, logs, reshare };
}

test("passes the mutated group directly to existing-grant rewrap", async () => {
  const { coordinator, reshare } = createHarness();

  await coordinator.reshareAfterGroupChange({
    memberGroupId: "members-group",
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledWith({
    containerContents: CONTAINER_CONTENTS,
    log: expect.any(Function),
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
});

test("a verified Members id gates unrelated group rewraps", async () => {
  const { coordinator, reshare } = createHarness();

  await coordinator.reshareAfterGroupChange({
    memberGroupId: "members-group",
    mutatedGroupId: "custom-group",
    organizationId: "org-1",
  });

  expect(reshare).not.toHaveBeenCalled();
});

test("swallows and logs a best-effort re-share failure", async () => {
  const reshare = mock(async () => {
    throw new Error("share failed");
  }) as unknown as ReshareOrganizationMetadataAfterGroupChange;
  const { coordinator, logs } = createHarness({ reshare });

  await coordinator.reshareAfterGroupChange({
    memberGroupId: "members-group",
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("share failed");
});

test("identity failures terminally stop later attempts", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const reshare = mock(async () => {
    throw integrityError;
  }) as unknown as ReshareOrganizationMetadataAfterGroupChange;
  const { coordinator, logs } = createHarness({ reshare });

  await coordinator.reshareAfterGroupChange({
    memberGroupId: "members-group",
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });
  await coordinator.reshareAfterGroupChange({
    memberGroupId: "members-group",
    mutatedGroupId: "members-group",
    organizationId: "org-1",
  });

  expect(reshare).toHaveBeenCalledTimes(1);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("identity integrity failure");
});
