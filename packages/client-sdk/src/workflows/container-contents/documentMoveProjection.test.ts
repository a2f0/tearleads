import { expect, test } from "bun:test";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { listContainerContentsDocumentsForContainers } from "./documentSubtreeQueries";

test.each([true, false])(
  "a refresh between link and unlink preserves the optimistic trash placement (unlink succeeds: %s)",
  async (unlinkAvailable) => {
    const rootCounts: number[] = [];
    const trashCounts: number[] = [];
    const fixture = await runQueuedDocumentMoveFixture({
      testDbName: `move-projection-${unlinkAvailable}`,
      unlinkAvailable,
      beforeUnlink: async (execSql) => {
        const root = await listContainerContentsDocumentsForContainers(
          execSql,
          ["queued-move-root-container"],
          { sortDocumentSummaries: false },
        );
        rootCounts.push(root.documentSummaries.length);
        const trash = await listContainerContentsDocumentsForContainers(
          execSql,
          ["queued-move-trash-container"],
          { sortDocumentSummaries: false },
        );
        trashCounts.push(trash.documentSummaries.length);
      },
    });
    expect(rootCounts).toEqual([0]);
    expect(trashCounts).toEqual([1]);
    expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
    expect(fixture.pendingIntents).toHaveLength(unlinkAvailable ? 0 : 1);
  },
);
