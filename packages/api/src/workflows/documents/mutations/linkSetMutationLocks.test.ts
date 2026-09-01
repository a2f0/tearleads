import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import {
  createDocumentLinkSetMutationLockPlan,
  executeDocumentLinkSetMutationLockPlan,
  lockDocumentLinkSetMutationHeads,
} from "./linkSetMutationLocks";

function mutationRequest(input: {
  readonly authorizingIds: readonly string[];
  readonly targetIds: readonly string[];
}): DocumentLinkSetMutationRequest {
  const target = (containerId: string) => ({
    containerId,
    containerManifestHash: crypto.randomUUID(),
    containerKeyEpochId: crypto.randomUUID(),
    containerKeyEpoch: 1,
    wrappedKey: "wrapped-key",
    wrappingMetadata: {},
  });
  return {
    authorizingContainerPathRefs: [
      input.authorizingIds.map((containerId) => ({
        containerId,
        manifestHash: crypto.randomUUID(),
      })),
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "manifest-hash",
      targetHash: "target-hash",
      targets: input.targetIds.map(target),
    },
    targetContainerPathRefs: input.targetIds.map((containerId) => ({
      containerId,
      manifestHash: crypto.randomUUID(),
    })),
  } as DocumentLinkSetMutationRequest;
}

test("link-set mutation locks every container head before the document head", () => {
  const documentId = crypto.randomUUID();
  const containers = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const plan = createDocumentLinkSetMutationLockPlan({
    documentId,
    previousLinkedContainerIds: [
      containers[1] as string,
      containers[0] as string,
    ],
    request: mutationRequest({
      authorizingIds: [containers[0] as string, containers[2] as string],
      targetIds: [containers[2] as string, containers[1] as string],
    }),
  });

  expect(plan).toEqual([
    {
      mode: "share",
      objectIds: [...containers].sort(),
      objectKind: "container",
    },
    { mode: "update", objectIds: [documentId], objectKind: "document" },
  ]);
});

test("a concurrent container rekey blocks document-head acquisition", async () => {
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const plan = createDocumentLinkSetMutationLockPlan({
    documentId,
    previousLinkedContainerIds: [containerId],
    request: mutationRequest({
      authorizingIds: [containerId],
      targetIds: [containerId],
    }),
  });
  let releaseContainerLock: () => void = () => undefined;
  const containerLock = new Promise<void>((resolve) => {
    releaseContainerLock = resolve;
  });
  const acquired: string[] = [];
  const execution = executeDocumentLinkSetMutationLockPlan(
    plan,
    async (step) => {
      acquired.push(`${step.objectKind}:${step.mode}`);
      if (step.objectKind === "container") {
        await containerLock;
      }
    },
  );

  await Promise.resolve();
  expect(acquired).toEqual(["container:share"]);
  releaseContainerLock();
  await execution;
  expect(acquired).toEqual(["container:share", "document:update"]);
});

test("link-set mutation lock statements run against the configured database", async () => {
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const request = mutationRequest({
    authorizingIds: [containerId],
    targetIds: [containerId],
  });

  await db.transaction((executor) =>
    lockDocumentLinkSetMutationHeads({
      documentId,
      executor,
      previousLinkedContainerIds: [containerId],
      request,
    }),
  );
  expect(true).toBe(true);
});
