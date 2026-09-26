import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence as persistence } from "../../data/persistence/container-contents/containerContentsPersistence";

const SERVER_TIME = "2026-01-01T00:00:01.000Z";
const LOCAL_TIME = "2026-01-01T00:00:02.000Z";

test.each([
  { kind: "read", pending: null },
  { kind: "read", pending: "metadata" },
  { kind: "read", pending: "move" },
  { kind: "accepted", pending: null },
  { kind: "accepted", pending: "metadata" },
  { kind: "accepted", pending: "move" },
] as const)(
  "metadata sync preserves server clocks and remaining work: %j",
  async ({ kind, pending }) => {
    const { execSql, close } = await createTestExecSql("metadata-clock");
    try {
      await persistence.ensureSchema(execSql);
      const container = {
        id: "clock-container",
        icon: null,
        name: "Container",
        organizationId: "org",
        parentId: "parent",
        metadataDocumentId: "clock-metadata",
      };
      const record = {
        id: container.id,
        documentId: container.metadataDocumentId,
        accessEpoch: 1,
        metadataUpdates: "",
        snapshotEndVersion: "",
      };
      await persistence.saveContainer(execSql, container, record, {
        localUpdatedAt:
          kind === "read" && pending === null ? SERVER_TIME : LOCAL_TIME,
        serverTimestamps: { createdAt: SERVER_TIME, updatedAt: SERVER_TIME },
        ...(pending === "move"
          ? {
              moveIntent: {
                parentContainerId: "parent",
                previousParentContainerId: "old-parent",
              },
            }
          : {}),
      });
      const pendingId =
        kind === "accepted"
          ? await persistence.enqueuePendingUpdate(execSql, {
              containerId: container.id,
              updateData: "update",
              partialStartVersionVector: "",
              partialEndVersionVector: "",
            })
          : null;
      if (pending === "metadata") {
        await persistence.enqueuePendingUpdate(execSql, {
          containerId: container.id,
          updateData: "unsent",
          partialStartVersionVector: "",
          partialEndVersionVector: "",
        });
      }
      const current = await persistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
      if (!current?.record) throw new Error("Expected stored container");
      const synced = await persistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: pendingId ? [pendingId] : [],
        container: current.container,
        expectedContainer: current.container,
        expectedRecord: current.record,
        record: { ...current.record, lastCommitLsn: "0/1" },
        settleAcceptedPendingOnConflict: true,
      });
      expect(synced.committed).toBe(true);
      const settled = await persistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
      expect(settled?.container.serverUpdatedAt).toBe(SERVER_TIME);
      expect(settled?.container.localUpdatedAt).toBe(
        pending ? LOCAL_TIME : SERVER_TIME,
      );
      expect(
        await persistence.listPendingUpdates(execSql, container.id),
      ).toHaveLength(pending === "metadata" ? 1 : 0);
      expect(await persistence.listUnsyncedMoveIntents(execSql)).toHaveLength(
        pending === "move" ? 1 : 0,
      );
      if (!settled?.record) throw new Error("Expected synced container");
      const discovered = await persistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: { ...settled.container, parentId: "new-parent" },
        expectedContainer: settled.container,
        expectedRecord: settled.record,
        record: settled.record,
        preserveDurableStructureWhenPending: true,
        saveOptions: { serverTimestamps: { updatedAt: LOCAL_TIME } },
        settleAcceptedPendingOnConflict: false,
      });
      expect(discovered).toMatchObject({
        committed: true,
        container: { parentId: pending === "move" ? "parent" : "new-parent" },
      });
    } finally {
      close();
    }
  },
);
