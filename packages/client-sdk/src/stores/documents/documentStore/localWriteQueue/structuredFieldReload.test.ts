import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../../../data/blobs/blobContracts";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { attachFilesToDocumentStore } from "../attachments";
import { reloadDocumentFromDurableHistory } from "../history/durableDocumentReload";
import {
  ensureDeferredBirthSchema,
  openPdfStore,
  PDF_UPLOAD,
  readQueuedUpdates,
} from "../initialization/deferredInitialUpdate.testFixtures";
import { ensureDocumentStoreReady } from "../initialization/index";
import { setDocumentStructuredFields } from "../mutations";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";

const noopSchedule = () => undefined;

test("a patch to another field survives a durable reload queued before it", async () => {
  const { close, execSql } = await createTestExecSql("field-reload-between");
  const stateRef: { current: DocumentStoreState | null } = { current: null };
  // Another writer reloads the store from durable history mid-stage while
  // keeping its queued writes (same identity), as an attach rollback does.
  const memory = createMemoryBlobStore();
  const blobStore = Object.assign(Object.create(memory) as BlobStore, {
    writeByteSource: async (
      ...args: Parameters<BlobStore["writeByteSource"]>
    ) => {
      const state = stateRef.current;
      if (!state) throw new Error("Store under test is not open");
      const generation = captureDocumentStoreSyncGeneration(state, state.doc);
      if (!generation) throw new Error("Expected a live generation");
      await reloadDocumentFromDurableHistory({
        expectedGeneration: generation,
        preserveQueuedWritesWhenIdentityMatches: true,
        state,
      });
      return memory.writeByteSource(...args);
    },
  });
  try {
    await ensureDeferredBirthSchema(execSql);
    const localId = "field-reload-between";
    const state = await openPdfStore({
      blobStore,
      deferInitialUpdate: false,
      execSql,
      localId,
    });
    stateRef.current = state;

    const writes = [
      setDocumentStructuredFields(state, noopSchedule, "pdf", {
        fileName: "report.pdf",
      }),
      attachFilesToDocumentStore(state, noopSchedule, [PDF_UPLOAD]),
      setDocumentStructuredFields(state, noopSchedule, "pdf", {
        mimeType: "application/pdf",
      }),
    ];
    await Promise.all(writes);

    const expected = { fileName: "report.pdf", mimeType: "application/pdf" };
    expect((await readQueuedUpdates(state)).structuredFields).toMatchObject(
      expected,
    );
    const reopened = createDocumentStoreState(
      localId,
      state.runtime,
      state.persistence,
      state.effects,
      null,
      "",
      "pdf",
    );
    expect(await ensureDocumentStoreReady(reopened, noopSchedule)).toBe(true);
    expect(reopened.snapshot.structuredFields).toMatchObject(expected);
  } finally {
    close();
  }
});
