import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";

test.each([false, true])(
  "a missing routing source cannot defer explicit unlinks (missing: %s)",
  async (missingSource) => {
    const fixture = await runQueuedDocumentMoveFixture({
      testDbName: "tombstone-link-routing",
      linkOnly: true,
      extraLocalLink: true,
      absentLocalContainerIds: missingSource
        ? ["queued-move-root-container"]
        : [],
      unlinkAvailable: true,
      beforeReplay: async (execSql) => {
        await intents.enqueueUnlinkIntent(execSql, {
          documentId: "queued-move-document",
          localId: "queued-move-local",
          removedContainerId: "queued-move-root-container",
          targetContainerId: "queued-move-root-container",
        });
      },
    });
    expect(fixture.remoteLinkedContainerIds).not.toContain(
      fixture.rootContainerId,
    );
    expect(fixture.remoteLinkedContainerIds).toEqual([
      fixture.extraContainerId,
      fixture.trashContainerId,
    ]);
    expect(fixture.submittedOperations).toContain("unlink");
    expect(fixture.pendingIntents).toEqual([]);
    expect(fixture.remainingLinkTargets).toEqual([]);
  },
);
