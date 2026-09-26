import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";

test.each(["pending", "blocked", "denied"])(
  "a removal invalidates an in-flight %s link replay's unavailable result",
  async (syncStatus) => {
    const fixture = await runQueuedDocumentMoveFixture({
      testDbName: "tombstone-partial-link-race",
      linkOnly: true,
      extraLocalLink: true,
      absentLocalContainerIds: ["queued-move-trash-container"],
      unlinkAvailable: false,
      beforeReplay: async (execSql) => {
        const [observed] = await intents.listPendingMoveIntents(execSql);
        if (!observed) throw new Error("Missing observed intent");
        await execSql("UPDATE document_move_intents SET sync_status = ?", [
          syncStatus,
        ]);
        await containers.deleteContainers(
          execSql,
          [
            {
              containerId: "queued-move-trash-container",
              reason: "deleted",
              updatedAt: new Date().toISOString(),
            },
          ],
          { discoveryOnly: true },
        );
        // A second pane finishes its pre-removal request after the cascade.
        await intents.recordMoveIntentError(execSql, {
          documentId: observed.documentId,
          expectedIntentId: observed.id,
          message: "Old request reports the target unavailable",
          unavailable: true,
        });
        const [stored] = await execSql(
          "SELECT id, sync_status FROM document_move_intents",
        );
        expect(stored).toBeDefined();
        expect(Reflect.get(stored ?? {}, "id")).not.toBe(observed.id);
        expect(Reflect.get(stored ?? {}, "sync_status")).toBe(syncStatus);
        const [current] = await intents.listPendingMoveIntents(execSql);
        if (syncStatus === "denied") {
          expect(current).toBeUndefined();
        } else {
          expect(current?.additionalLinkContainerIds).toEqual(
            observed.additionalLinkContainerIds,
          );
        }
      },
    });
    if (!fixture.extraContainerId) throw new Error("Missing extra container");
    expect(fixture.remoteLinkedContainerIds).toContain(
      fixture.extraContainerId,
    );
    expect(fixture.remoteLinkedContainerIds).not.toContain(
      fixture.trashContainerId,
    );
    expect(fixture.pendingIntents).toHaveLength(1);
    expect(fixture.remainingLinkTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ container_id: fixture.trashContainerId }),
      ]),
    );
  },
);
