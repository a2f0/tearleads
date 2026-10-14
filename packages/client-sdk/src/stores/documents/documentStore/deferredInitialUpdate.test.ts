import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { hasDeferredTailScopeWork } from "../../../workflows/container-contents/pendingWrites/deferredTails";
import { attachFilesToDocumentStore } from "./attachments";
import {
  ensureDeferredBirthSchema,
  openPdfStore,
  PDF_FIELDS,
  PDF_UPLOAD,
  readQueuedUpdates,
} from "./deferredInitialUpdate.testFixtures";
import { setDocumentStructuredFields } from "./mutations";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";

const noopSchedule = () => undefined;
const SCOPE = (localId: string) => ({ appKind: "documents", localId });

test("a deferred birth rides the first attach as the file's only update", async () => {
  const { close, execSql } = await createTestExecSql("deferred-birth-attach");
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = await openPdfStore({
      blobStore: createMemoryBlobStore(),
      deferInitialUpdate: true,
      execSql,
      localId: "imported-pdf",
    });
    // The committed birth is visible to the write queue and to manual retry
    // as deferred work before anything is enqueued.
    expect((await readQueuedUpdates(state)).rowCount).toBe(0);
    expect(await hasDeferredTailScopeWork(execSql, SCOPE(state.localId))).toBe(
      true,
    );

    await setDocumentStructuredFields(state, noopSchedule, "pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });
    expect((await readQueuedUpdates(state)).rowCount).toBe(0);
    await attachFilesToDocumentStore(state, noopSchedule, [PDF_UPLOAD]);

    expect(await readQueuedUpdates(state)).toEqual({
      attachmentNames: ["report.pdf"],
      documentKind: "pdf",
      rowCount: 1,
      structuredFields: PDF_FIELDS,
    });
    expect(state.pendingAttachments).toHaveLength(1);
    expect(await hasDeferredTailScopeWork(execSql, SCOPE(state.localId))).toBe(
      false,
    );
  } finally {
    close();
  }
});

test("an undeferred birth still enqueues at creation", async () => {
  const { close, execSql } = await createTestExecSql("undeferred-birth");
  try {
    await ensureDeferredBirthSchema(execSql);
    const state = await openPdfStore({
      blobStore: createMemoryBlobStore(),
      deferInitialUpdate: false,
      execSql,
      localId: "imported-json",
    });

    expect(await readQueuedUpdates(state)).toMatchObject({
      documentKind: "pdf",
      rowCount: 1,
    });
    expect(await hasDeferredTailScopeWork(execSql, SCOPE(state.localId))).toBe(
      false,
    );
  } finally {
    close();
  }
});

test("a restart between birth and attach keeps the birth in the next update", async () => {
  const { close, execSql } = await createTestExecSql("deferred-birth-restart");
  const blobStore = createMemoryBlobStore();
  try {
    await ensureDeferredBirthSchema(execSql);
    await openPdfStore({
      blobStore,
      deferInitialUpdate: true,
      execSql,
      localId: "restarted-pdf",
    });

    // A fresh store over the same database, as after a process restart: the
    // marker restores at the empty version, so the attach exports the birth.
    const reopened = await openPdfStore({
      blobStore,
      deferInitialUpdate: false,
      execSql,
      localId: "restarted-pdf",
    });
    await attachFilesToDocumentStore(reopened, noopSchedule, [PDF_UPLOAD]);

    expect(await readQueuedUpdates(reopened)).toMatchObject({
      attachmentNames: ["report.pdf"],
      documentKind: "pdf",
      rowCount: 1,
    });
  } finally {
    close();
  }
});

test("a sync pass after a restart ships a deferred birth with no further writes", async () => {
  const { close, execSql } = await createTestExecSql("deferred-birth-sync");
  const blobStore = createMemoryBlobStore();
  try {
    await ensureDeferredBirthSchema(execSql);
    await openPdfStore({
      blobStore,
      deferInitialUpdate: true,
      execSql,
      localId: "synced-pdf",
    });
    const reopened = await openPdfStore({
      blobStore,
      deferInitialUpdate: false,
      execSql,
      localId: "synced-pdf",
    });
    const generation = captureDocumentStoreSyncGeneration(
      reopened,
      reopened.doc,
    );
    if (!generation || !reopened.doc) {
      throw new Error("Expected a live reopened document");
    }

    const prepared = await prepareDocumentOutgoingCoverage({
      currentDoc: reopened.doc,
      generation,
      pendingUpdates: [],
      state: reopened,
    });

    expect(prepared?.pendingUpdates).toHaveLength(1);
    expect(await readQueuedUpdates(reopened)).toMatchObject({
      attachmentNames: [],
      documentKind: "pdf",
      rowCount: 1,
    });
    expect(await hasDeferredTailScopeWork(execSql, SCOPE("synced-pdf"))).toBe(
      false,
    );
  } finally {
    close();
  }
});
