import { expect, test } from "bun:test";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { getDomainDownloadHistorySnapshot } from "../../../../data/sync/downloadHistory";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

/**
 * Rotate the content key of a stored document, optionally one whose pull
 * still has a page left, and return what the download history recorded.
 */
async function rotate(name: string, queued: boolean) {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = `${name}-local`;
    const documentId = fixture.writerProjection.documentId;
    const behind = await createDocument(`${name}-behind`);
    importSnapshot(behind, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behind,
      documentId,
      execSql,
      localId,
    });
    if (queued) {
      const stored = await sqlDocumentsPersistence.loadDocument(
        execSql,
        localId,
      );
      if (!stored) throw new Error("Expected persisted document");
      await sqlDocumentsPersistence.saveDocument(execSql, {
        ...stored,
        pullContinuation: {
          commitLsn: "0/1",
          commitLsnMode: "tracked",
          cursor: "page-2",
        },
      });
    }
    const runtime = createRotationRecoveryRuntime({ execSql, fixture });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    expect(await assertDocumentStoreCanRotateContentKey(state)).toBeInstanceOf(
      Uint8Array,
    );
    state.doc?.free();
    fixture.remoteDocument.free();
    return {
      completed: getDomainDownloadHistorySnapshot(runtime.state.domainScope)
        .completed,
      documentId,
      localId,
    };
  } finally {
    close();
  }
}

test("a rotation recovery pull that drains a queued download records it", async () => {
  const { completed, documentId, localId } = await rotate(
    "rotation-download-queued",
    true,
  );
  expect(completed).toMatchObject([
    { documentId, localId, objectKind: "document" },
  ]);
});

test("rotating a stored document's key is not a download", async () => {
  const { completed } = await rotate("rotation-download-stored", false);
  expect(completed).toEqual([]);
});
