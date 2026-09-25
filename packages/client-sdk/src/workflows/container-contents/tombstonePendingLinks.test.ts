import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";

for (const parked of [false, true]) {
  test.each([false, true])(
    `missing link destinations preserve additions (preferred missing: %s, parked=${parked})`,
    async (preferredMissing) => {
      const fixture = await runQueuedDocumentMoveFixture({
        testDbName: "tombstone-partial-link",
        linkOnly: true,
        extraLocalLink: true,
        absentLocalContainerIds: ["queued-move-trash-container"],
        unlinkAvailable: false,
        beforeReplay: async (execSql) => {
          if (parked)
            await execSql(
              "UPDATE document_move_intents SET sync_status = 'unavailable'",
            );
          if (preferredMissing)
            await execSql(
              "UPDATE document_move_intents SET target_container_id = ?",
              ["queued-move-trash-container"],
            );
          await containers.deleteContainers(
            execSql,
            [
              {
                containerId: "queued-move-trash-container",
                reason: "deleted",
                updatedAt: new Date().toISOString(),
              },
            ],
            {
              discoveryOnly: true,
            },
          );
        },
      });
      if (!fixture.extraContainerId) throw new Error("Missing extra container");
      expect(fixture.remoteLinkedContainerIds).toContain(
        fixture.extraContainerId,
      );
      expect(fixture.remoteLinkedContainerIds).toContain(
        fixture.rootContainerId,
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
}
