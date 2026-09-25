import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlContainerContentsPersistence as containers } from "../../data/persistence/container-contents/containerContentsPersistence";

test("a missing link destination preserves its intent while other additions progress", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "tombstone-partial-link",
    linkOnly: true,
    extraLocalLink: true,
    absentLocalContainerIds: ["queued-move-trash-container"],
    unlinkAvailable: false,
    beforeReplay: async (execSql) => {
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
  expect(fixture.remoteLinkedContainerIds).toContain(fixture.extraContainerId);
  expect(fixture.remoteLinkedContainerIds).toContain(fixture.rootContainerId);
  expect(fixture.remoteLinkedContainerIds).not.toContain(
    fixture.trashContainerId,
  );
  expect(fixture.pendingIntents).toHaveLength(1);
  expect(fixture.remainingLinkTargets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ container_id: fixture.trashContainerId }),
    ]),
  );
});
