import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";
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

test("moving a different link preserves an earlier queued move destination", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-move-another-link",
    extraLocalLink: true,
    unlinkAvailable: true,
    replaceLinkedContainers: false,
    beforeReplay: async (execSql) => {
      await intents.enqueueMoveIntent(execSql, {
        id: "other-link-move",
        documentId: "queued-move-document",
        localId: "queued-move-local",
        sourceContainerId: "queued-move-extra-container",
        targetContainerId: "queued-move-root-container",
      });
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-root-container", "queued-move-trash-container"],
        { moveIntentId: "other-link-move" },
      );
    },
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.rootContainerId,
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
});

test("recovering an orphan does not restore its deleted queued destination", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-move-deleted-recovery",
    remoteOnlySourceContainer: true,
    unlinkAvailable: true,
    containerProjectionFailureFor: "trash",
    containerProjectionFailure: {
      status: 404,
      message: "deleted",
      code: "container_unavailable",
    },
    beforeReplay: async (execSql) => {
      await containers.ensureSchema(execSql);
      await containers.deleteContainer(execSql, "queued-move-trash-container", {
        updatedAt: new Date().toISOString(),
      });
      await intents.enqueueMoveIntent(execSql, {
        id: "orphan-recovery",
        documentId: "queued-move-document",
        localId: "queued-move-local",
        sourceContainerId: null,
        targetContainerId: "queued-move-extra-container",
      });
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-extra-container"],
        {
          moveIntentId: "orphan-recovery",
        },
      );
    },
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
});

test("additive settlement preserves a link activated during its remote request", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-active-settlement",
    linkOnly: true,
    unlinkAvailable: false,
    beforeLink: async (execSql) => {
      await execSql(
        "UPDATE document_projection SET container_id = ? WHERE local_id = ?",
        ["queued-move-trash-container", "queued-move-local"],
      );
    },
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.persistedDocument?.containerId).toBe(fixture.trashContainerId);
  expect(fixture.pendingIntents).toEqual([]);
});

test("unlinking another container after activating a link preserves the queued move destination", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-move-activate-unlink",
    extraLocalLink: true,
    unlinkAvailable: true,
    replaceLinkedContainers: false,
    beforeReplay: async (execSql) => {
      await execSql(
        "UPDATE document_projection SET container_id = ? WHERE local_id = ?",
        ["queued-move-extra-container", "queued-move-local"],
      );
      await intents.enqueueUnlinkIntent(execSql, {
        documentId: "queued-move-document",
        localId: "queued-move-local",
        targetContainerId: "queued-move-extra-container",
        removedContainerId: "unrelated-container",
      });
    },
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

test("recovered additions preserve another activated link without an implicit unlink", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-link-recovered-active",
    linkOnly: true,
    remoteOnlySourceContainer: true,
    remoteUnlinkSource: true,
    unlinkAvailable: true,
    beforeReplay: async (execSql) => {
      await containers.ensureSchema(execSql);
      await containers.deleteContainer(execSql, "queued-move-root-container", {
        updatedAt: new Date().toISOString(),
      });
      const [intent] = await intents.listPendingMoveIntents(execSql);
      if (!intent) throw new Error("Missing recovered intent");
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-extra-container", "queued-move-trash-container"],
        { moveIntentId: intent.id },
      );
      await execSql(
        "UPDATE document_projection SET container_id = ? WHERE local_id = ?",
        ["queued-move-extra-container", "queued-move-local"],
      );
    },
  });
  expect(fixture.syncedCount).toBe(1);
  expect(fixture.submittedOperations).toEqual(["link"]);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
    fixture.trashContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual(fixture.remoteLinkedContainerIds);
  expect(fixture.pendingIntents).toEqual([]);
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

test("a coalesced round-trip move restores its target after the first replay unlinks it", async () => {
  let returned = false;
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "queued-move-round-trip",
    unlinkAvailable: true,
    remoteOnlySourceContainer: true,
    replaceLinkedContainers: false,
    passes: 2,
    beforeUnlink: async (execSql) => {
      if (returned) return;
      returned = true;
      await intents.enqueueMoveIntent(execSql, {
        id: "return-move",
        documentId: "queued-move-document",
        localId: "queued-move-local",
        sourceContainerId: "queued-move-trash-container",
        targetContainerId: "queued-move-root-container",
      });
      await links.replaceDocumentLinks(
        execSql,
        "queued-move-document",
        ["queued-move-root-container"],
        { moveIntentId: "return-move" },
      );
    },
  });
  expect(fixture.passes.map((pass) => pass.syncedCount)).toEqual([0, 1]);
  expect(fixture.persistedDocument?.containerId).toBe(fixture.rootContainerId);
  expect(fixture.remoteLinkedContainerIds).toEqual([
    fixture.extraContainerId ?? "missing-extra",
    fixture.rootContainerId,
  ]);
  expect(fixture.pendingIntents).toEqual([]);
});
