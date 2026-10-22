import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../../../workflows/documents";
import { retireDocumentStore } from "../../registry";
import { openDocumentStore } from "../index";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "./deferredInitialUpdate.testFixtures";

const LOCAL_ID = "removed-note";
const DOCUMENT_ID = "remote-removed-note";

test("an editor reopening a removed document does not recreate it while paused", async () => {
  const { close, execSql } = await createTestExecSql("removed-document-reopen");
  try {
    await ensureDeferredBirthSchema(execSql);
    const runtime = offlineAttachRuntime({
      blobStore: createMemoryBlobStore(),
      canAttach: true,
      execSql,
    });
    const { domainScope } = runtime.state;
    const reopen = () =>
      openDocumentStore(
        domainScope,
        LOCAL_ID,
        runtime,
        DOCUMENT_ID,
        "",
        "note",
      );
    const loadRow = () =>
      defaultDocumentsPersistence.loadDocument(execSql, LOCAL_ID);
    const editor = reopen();
    expect(await editor.ensureInitialized()).toBe(true);
    expect(await loadRow()).not.toBeNull();

    // A paused organization's cleanup removes the document under the editor.
    expect(
      await deletePersistedDocument({
        documentProjectors: runtime.infra.documentProjectors,
        execSql,
        localId: LOCAL_ID,
        persistence: defaultDocumentsPersistence,
      }),
    ).toBe(true);
    let paused = true;
    retireDocumentStore(domainScope, LOCAL_ID, () => paused);

    // The editor reopens on a runtime update; a fresh store would recreate the
    // document and download it again.
    expect(reopen()).toBe(editor);
    expect(await editor.ensureInitialized()).toBe(false);
    expect(await loadRow()).toBeNull();

    // Once resumed, reopening loads the document again.
    paused = false;
    expect(reopen()).toBe(editor);
    expect(await editor.ensureInitialized()).toBe(true);
    expect(await loadRow()).not.toBeNull();
  } finally {
    close();
  }
});
