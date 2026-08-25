import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
} from "@symcrypt/loro";
import { createCoverageFixture } from "../../../../test/helpers/syncOutgoingCoverage";
import type { DocumentsPersistence } from "../../../workflows/documents";
import { reloadDocumentFromDurableHistory } from "./durableDocumentReload";
import { setDocumentText } from "./mutations";
import { persistDocument } from "./persistence";

test("rollback reload merges history advanced by another pane", async () => {
  const fixture = await createCoverageFixture(
    "durable-reload-history-race",
    false,
  );
  try {
    const rollbackSnapshot = exportFullHistorySnapshot(
      fixture.document,
    ).slice();
    const rollbackVersion = encodeVersionVector(fixture.document);
    const advancedDocument = await createDocument(
      "durable-reload-history-race-remote",
    );
    importSnapshot(advancedDocument, rollbackSnapshot);
    advancedDocument.getText("text").update("content from concurrent page");
    const advancedUpdate = exportUpdatesSince(
      advancedDocument,
      rollbackVersion,
    );
    const advancedVersion = encodeVersionVector(advancedDocument);

    const basePersistence = fixture.state.persistence;
    let advancedDuringReload = false;
    fixture.state.persistence = {
      ...basePersistence,
      async loadDocumentWithHistoryRestoreState(execSql, localId) {
        if (!advancedDuringReload) {
          advancedDuringReload = true;
          await basePersistence.appendHistoryUpdates(execSql, {
            localId,
            origin: "remote",
            updates: [bytesToBase64(advancedUpdate)],
          });
          const current = await basePersistence.loadDocument(execSql, localId);
          if (!current) throw new Error("Expected durable document record");
          await basePersistence.saveDocument(execSql, {
            ...current,
            pendingBaseVersion: advancedVersion,
            snapshotEndVersion: advancedVersion,
            text: "content from concurrent page",
          });
        }
        return basePersistence.loadDocumentWithHistoryRestoreState(
          execSql,
          localId,
        );
      },
    } satisfies DocumentsPersistence;

    expect(
      await reloadDocumentFromDurableHistory({
        expectedGeneration: fixture.generation,
        preserveQueuedWritesWhenIdentityMatches: true,
        sameIdentitySnapshot: rollbackSnapshot,
        state: fixture.state,
      }),
    ).toBe(true);

    expect(advancedDuringReload).toBe(true);
    expect(getTextValue(fixture.state.doc ?? fixture.document)).toBe(
      "content from concurrent page",
    );
    expect(fixture.state.pendingBaseVersion).toBe(advancedVersion);
    expect(fixture.state.record?.snapshotEndVersion).toBe(advancedVersion);
  } finally {
    fixture.close();
  }
});

test("identity CAS loss invalidates a write queued for the old CRDT", async () => {
  const fixture = await createCoverageFixture(
    "durable-reload-queued-write-relink",
    false,
  );
  let releaseQueuedWrite = () => {};
  const queuedWriteBlocked = new Promise<void>((resolve) => {
    releaseQueuedWrite = resolve;
  });
  try {
    const writableRecord = fixture.state.record;
    if (!writableRecord)
      throw new Error("Expected the initial document record");
    await fixture.state.persistence.saveDocument(fixture.execSql, {
      ...writableRecord,
      effectiveAccessLevel: "write",
    });
    fixture.state.record = await fixture.state.persistence.loadDocument(
      fixture.execSql,
      fixture.localId,
    );
    fixture.state.writeChain = queuedWriteBlocked;
    const queuedWrite = setDocumentText(
      fixture.state,
      () => undefined,
      "must not enter replacement",
    );
    const previousGeneration = fixture.state.localWriteGeneration;
    expect(fixture.state.pendingLocalWrites).toBe(1);

    const replacement = await createDocument(
      "durable-reload-queued-write-replacement",
    );
    replacement.getText("text").update("replacement content");
    replacement.commit();
    const replacementVersion = encodeVersionVector(replacement);
    const staleRecord = fixture.state.record;
    if (!staleRecord) throw new Error("Expected the stale document record");
    await fixture.state.persistence.saveDocument(fixture.execSql, {
      ...staleRecord,
      accessEpoch: staleRecord.accessEpoch + 1,
      documentId: "replacement-document",
      pendingBaseVersion: replacementVersion,
      snapshotEndVersion: replacementVersion,
      text: "replacement content",
    });
    await fixture.state.persistence.replaceHistoryCheckpoint(fixture.execSql, {
      coveredTailIds: [],
      endVersionVector: replacementVersion,
      force: true,
      localId: fixture.localId,
      snapshot: bytesToBase64(exportFullHistorySnapshot(replacement)),
    });

    const persisted = await persistDocument(fixture.state, fixture.document);
    expect(persisted?.syncIdentitySuperseded).toBe(true);
    expect(fixture.state.localWriteGeneration).toBe(previousGeneration + 1);
    expect(fixture.state.pendingLocalWrites).toBe(0);
    expect(fixture.state.record?.documentId).toBe("replacement-document");
    expect(getTextValue(fixture.state.doc ?? fixture.document)).toBe(
      "replacement content",
    );

    releaseQueuedWrite();
    await queuedWrite;
    expect(
      await fixture.state.persistence.listPendingUpdates(
        fixture.execSql,
        fixture.localId,
      ),
    ).toEqual([]);
    expect(getTextValue(fixture.state.doc ?? fixture.document)).toBe(
      "replacement content",
    );
  } finally {
    releaseQueuedWrite();
    fixture.close();
  }
});
