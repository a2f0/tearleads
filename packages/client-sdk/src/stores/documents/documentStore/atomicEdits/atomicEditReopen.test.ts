import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import {
  createAtomicEditFixture,
  prepareAtomicCoverage,
  reopenAtomicEdit,
} from "../../../../../test/helpers/atomicEditCoverage";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import { readStoredDocumentState } from "../../../../data/documents/documentKinds";
import { listDocumentRows } from "../../../../data/documents/documentRowList";
import { sqlDocumentsPersistence as documents } from "../../../../data/persistence/documents/documentsPersistence";
import { attachFilesToDocumentStore } from "../attachments";
import { removeAttachmentFromDocumentStore } from "../attachments/attachmentRemoval";
import {
  offlineAttachRuntime,
  PDF_UPLOAD,
} from "../initialization/deferredInitialUpdate.testFixtures";
import { setDocumentStructuredFields, setDocumentText } from "../mutations";
import { persistDocument } from "../persistence";
import { addRowToDocumentStore } from "../rows";

test.each(["text", "row", "attachment"] as const)(
  "%s queued edit survives a new file connection before sync without duplication",
  async (kind) => {
    const f = await createAtomicEditFixture(`atomic-reopen-${kind}`);
    let close = f.db.close;
    try {
      const baseline = exportFullHistorySnapshot(f.document);
      if (kind === "text")
        await setDocumentText(f.state, () => {}, "durable edit");
      if (kind === "row")
        await addRowToDocumentStore(f.state, () => {}, {
          value: "durable row",
        });
      if (kind === "attachment") {
        f.state.runtime = offlineAttachRuntime({
          blobStore: createMemoryBlobStore(),
          canAttach: true,
          execSql: f.execSql,
        });
        await attachFilesToDocumentStore(f.state, () => {}, [PDF_UPLOAD]);
      }
      const queued = await documents.listPendingUpdates(f.execSql, f.localId);
      expect(queued).toHaveLength(1);
      expect(f.state.record?.pendingBaseVersion).toBe(
        encodeVersionVector(f.document),
      );
      const reopened = await reopenAtomicEdit(f);
      close = reopened.db.close;
      expect(reopened.state.pendingBaseVersion).toBe(
        f.state.record?.pendingBaseVersion ?? null,
      );
      const first = await prepareAtomicCoverage(reopened.state);
      const second = await prepareAtomicCoverage(reopened.state);
      expect(first?.pendingUpdates).toEqual(queued);
      expect(second?.pendingUpdates).toEqual(queued);
      const peer = await createDocument(`atomic-peer-${kind}`);
      importSnapshot(peer, baseline);
      importUpdates(
        peer,
        queued.map((update) => base64ToBytes(update.updateData)),
      );
      expect(encodeVersionVector(peer)).toBe(
        encodeVersionVector(reopened.document),
      );
      if (kind === "text")
        expect(peer.getText("text").toString()).toBe("durable edit");
      if (kind === "row")
        expect(listDocumentRows(peer)[0]?.fields).toEqual({
          value: "durable row",
        });
      if (kind === "attachment") {
        expect(getDocumentAttachments(peer).map(({ name }) => name)).toEqual([
          PDF_UPLOAD.name,
        ]);
        expect(reopened.state.pendingAttachments).toHaveLength(1);
        const slotId = getDocumentAttachments(peer)[0]?.slotId;
        if (!slotId) throw new Error("Missing attachment");
        await removeAttachmentFromDocumentStore(
          reopened.state,
          () => {},
          slotId,
        );
        expect(reopened.state.record?.pendingBaseVersion).toBe(
          encodeVersionVector(reopened.document),
        );
        const removed = await prepareAtomicCoverage(reopened.state);
        expect(removed?.pendingUpdates).toHaveLength(2);
        importUpdates(
          peer,
          removed.pendingUpdates.map(({ updateData }) =>
            base64ToBytes(updateData),
          ),
        );
        expect(getDocumentAttachments(peer)).toEqual([]);
      }
      const prepared = await prepareAtomicCoverage(reopened.state);
      await persistDocument(
        reopened.state,
        reopened.document,
        {},
        {
          acceptedPendingUpdateIds: prepared.pendingUpdates.map(({ id }) => id),
        },
      );
      expect(
        (await prepareAtomicCoverage(reopened.state))?.pendingUpdates,
      ).toEqual([]);
    } finally {
      await close();
      await f.db.remove();
    }
  },
);

test("a deferred field edit keeps its lagging marker across a file reopen", async () => {
  const f = await createAtomicEditFixture("atomic-reopen-deferred");
  let close = f.db.close;
  try {
    const baseline = exportFullHistorySnapshot(f.document);
    await setDocumentStructuredFields(
      f.state,
      () => {},
      "contact",
      { firstName: "Ada" },
      { deferRemoteSync: true },
    );
    expect(f.state.record?.pendingBaseVersion).toBe(f.version);
    expect(f.state.record?.snapshotEndVersion).not.toBe(f.version);
    expect(await documents.listPendingUpdates(f.execSql, f.localId)).toEqual(
      [],
    );
    const reopened = await reopenAtomicEdit(f);
    close = reopened.db.close;
    expect(reopened.state.pendingBaseVersion).toBe(f.version);
    const prepared = await prepareAtomicCoverage(reopened.state);
    expect(prepared?.pendingUpdates).toHaveLength(1);
    const peer = await createDocument("deferred-peer");
    importSnapshot(peer, baseline);
    importUpdates(
      peer,
      prepared.pendingUpdates.map(({ updateData }) =>
        base64ToBytes(updateData),
      ),
    );
    expect(readStoredDocumentState(peer).structuredFields).toMatchObject({
      firstName: "Ada",
    });
    expect(
      (await prepareAtomicCoverage(reopened.state))?.pendingUpdates,
    ).toEqual(prepared?.pendingUpdates);
  } finally {
    await close();
    await f.db.remove();
  }
});
