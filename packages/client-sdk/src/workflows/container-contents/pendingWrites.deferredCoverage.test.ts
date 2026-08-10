import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "./documentQueries.testFixtures";
import { listPendingWrites } from "./pendingWrites";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

test("listPendingWrites unions the marker and queued vector before reporting a deferred tail", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-union-coverage",
  );
  try {
    await listPendingWrites(execSql);
    await saveTestSyncedContainer({
      execSql,
      id: "root",
      name: "/",
      organizationId: "organization-a",
      timestamp: UPDATED_AT,
    });

    const firstPeer = await createDocument("pending-write-first-peer");
    firstPeer.getText("text").update("first peer");
    firstPeer.commit();
    const firstPeerVersion = encodeVersionVector(firstPeer);
    const secondPeer = await createDocument("pending-write-second-peer");
    secondPeer.getMap("fields").set("second", true);
    secondPeer.commit();
    const secondPeerVersion = encodeVersionVector(secondPeer);
    importUpdates(firstPeer, [exportAllUpdates(secondPeer)]);

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: null,
        containerId: "root",
        documentId: "remote-union-covered",
        documentKind: "note",
        id: "union-covered-document",
        pendingBaseVersion: firstPeerVersion,
        snapshotEndVersion: encodeVersionVector(firstPeer),
        text: "",
        title: "Union covered",
      },
      { updatedAt: UPDATED_AT },
    );
    await insertTestPendingUpdate({
      appKind: "documents",
      createdAt: UPDATED_AT,
      execSql,
      id: "union-covered-update",
      localId: "union-covered-document",
      partialEndVersionVector: secondPeerVersion,
      updateData: "opaque-update",
    });

    const item = (await listPendingWrites(execSql)).find(
      (candidate) => candidate.localId === "union-covered-document",
    );
    expect(item?.operations).toEqual([
      expect.objectContaining({ kind: "update" }),
    ]);
  } finally {
    close();
  }
});
