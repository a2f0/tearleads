import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";

test("queued links replay signed additions without unlinking or rotating the source", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-success",
    linkOnly: true,
    extraLocalLink: true,
    unlinkAvailable: false,
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.submittedOperations).toEqual(["link", "link"]);
  expect(fixture.persistedDocument?.containerId).toBe(fixture.rootContainerId);
  expect(fixture.linkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
    fixture.rootContainerId,
    fixture.trashContainerId,
  ]);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    ...fixture.linkedContainerIds,
  ]);
  expect(fixture.pendingIntents).toEqual([]);
  expect(fixture.remainingLinkTargets).toEqual([]);
});

test("a link failure retains the local placement and retries from the durable intent", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-retry",
    linkOnly: true,
    unlinkAvailable: false,
    linkFailure: { message: "offline", status: null },
    linkFailureTimes: 1,
    passes: 2,
  });
  expect(fixture.passes.map((pass) => pass.syncedCount)).toEqual([0, 1]);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.rootContainerId,
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
});

test("a link added after a queued replace move survives its unlink phase", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-move-then-link",
    extraLocalLink: true,
    unlinkAvailable: true,
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
});

test("an older link response cannot settle a newer local move", async () => {
  let superseded = false;
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-superseded",
    linkOnly: true,
    unlinkAvailable: true,
    passes: 2,
    beforeLink: async (execSql) => {
      if (superseded) return;
      superseded = true;
      await intents.enqueueMoveIntent(execSql, {
        id: "new-move",
        documentId: "queued-move-document",
        localId: "queued-move-local",
        sourceContainerId: "queued-move-root-container",
        targetContainerId: "queued-move-trash-container",
        replaceLinkedContainers: true,
      });
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-trash-container"],
        { moveIntentId: "new-move" },
      );
    },
  });
  expect(fixture.passes.map((pass) => pass.syncedCount)).toEqual([0, 1]);
  expect(fixture.remoteLinkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.pendingIntents).toEqual([]);
  expect(fixture.remainingLinkTargets).toEqual([]);
});
