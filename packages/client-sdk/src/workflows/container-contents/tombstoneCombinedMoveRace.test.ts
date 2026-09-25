import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";

for (const additional of [false, true]) {
  test.each(["pending", "blocked", "unavailable"])(
    `a queued %s move survives an old 404 after its destination returns (additional=${additional})`,
    async (syncStatus) => {
      let observedId: string | undefined;
      let refreshedId: string | undefined;
      const fixture = await runQueuedDocumentMoveFixture({
        testDbName: "tombstone-combined-move-race",
        extraLocalLink: additional,
        unlinkAvailable: true,
        beforeReplay: async (execSql) => {
          const [observed] = await intents.listPendingMoveIntents(execSql);
          if (!observed) throw new Error("Missing combined move");
          observedId = observed.id;
          expect(observed.intentType).toBe("document.move");
          expect(observed.additionalLinkContainerIds ?? []).toEqual(
            additional ? ["queued-move-extra-container"] : [],
          );
          await execSql("UPDATE document_move_intents SET sync_status = ?", [
            syncStatus,
          ]);
          await containers.deleteContainers(
            execSql,
            [
              {
                containerId: additional
                  ? "queued-move-extra-container"
                  : "queued-move-trash-container",
                reason: "deleted",
                updatedAt: new Date().toISOString(),
              },
            ],
            { discoveryOnly: true },
          );
          const [refreshed] = await intents.listPendingMoveIntents(execSql);
          refreshedId = refreshed?.id;
          if (refreshed) {
            expect(refreshed.additionalLinkContainerIds).toEqual(
              observed.additionalLinkContainerIds,
            );
            expect(refreshed.targetContainerId).toBe(
              observed.targetContainerId,
            );
            expect(refreshed.replaceLinkedContainers).toBe(true);
          }
          await intents.recordMoveIntentError(execSql, {
            documentId: observed.documentId,
            expectedIntentId: observed.id,
            message: "An old request reports the additional link unavailable",
            unavailable: true,
          });
          // Replay sees all destinations again and verifies their signed paths.
        },
      });
      const expectedLinks = [fixture.trashContainerId];
      if (additional) {
        if (!fixture.extraContainerId)
          throw new Error("Missing additional destination");
        expectedLinks.unshift(fixture.extraContainerId);
      }
      expect(fixture.remoteLinkedContainerIds).toEqual(expectedLinks);
      expect(fixture.pendingIntents).toEqual([]);
      expect(fixture.intentRows).toEqual([]);
      expect(refreshedId).toBeDefined();
      expect(refreshedId).not.toBe(observedId);
    },
  );
}
