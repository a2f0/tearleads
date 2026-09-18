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

test("an additive replay does not restore the preferred link removed by a peer", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-peer-unlink",
    linkOnly: true,
    remoteOnlySourceContainer: true,
    remoteUnlinkSource: true,
    unlinkAvailable: true,
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.submittedOperations).toEqual(["link"]);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.persistedDocument?.containerId).not.toBe(
    fixture.rootContainerId,
  );
});

test("unlinking a partially replayed addition prevents retry from restoring it", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-then-unlink",
    linkOnly: true,
    extraLocalLink: true,
    unlinkAvailable: true,
    linkFailure: { status: null, message: "offline" },
    linkFailureTimes: 1,
    linkSuccessesBeforeFailure: 1,
    passes: 2,
    afterPass: async (pass, unlink) => {
      if (pass === 0)
        expect(await unlink("queued-move-extra-container")).not.toBeNull();
    },
  });
  expect(fixture.passes.map((pass) => pass.syncedCount)).toEqual([0, 1]);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.rootContainerId,
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
  expect(fixture.remainingLinkTargets).toEqual([]);
});

test("an in-flight addition cannot acknowledge a newer unlink", async () => {
  let removed = false;
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-in-flight-unlink",
    linkOnly: true,
    unlinkAvailable: true,
    passes: 2,
    beforeLink: async (execSql) => {
      if (removed) return;
      removed = true;
      await intents.enqueueUnlinkIntent(execSql, {
        id: "new-unlink",
        documentId: "queued-move-document",
        localId: "queued-move-local",
        removedContainerId: "queued-move-trash-container",
        targetContainerId: "queued-move-root-container",
      });
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-root-container"],
        { moveIntentId: "new-unlink" },
      );
    },
  });
  expect(fixture.passes.map((pass) => pass.syncedCount)).toEqual([0, 1]);
  expect(fixture.remoteLinkedContainerIds).toEqual([fixture.rootContainerId]);
  expect(fixture.linkedContainerIds).toEqual([fixture.rootContainerId]);
  expect(fixture.pendingIntents).toEqual([]);
});
