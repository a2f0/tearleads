import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents";
import { createDomainScope } from "../../../../data/shared/domainScope";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../../../workflows/documents";
import {
  getOrCreateOrganizationSyncPauses,
  recordPauseRemovedDocument,
} from "../../../../workflows/sync";
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

test("after a restart, reopening a removed document waits for the resume", async () => {
  const { close, execSql } = await createTestExecSql(
    "removed-document-restart",
  );
  try {
    await ensureDeferredBirthSchema(execSql);
    const openInNewSession = () => {
      const runtime = offlineAttachRuntime({
        blobStore: createMemoryBlobStore(),
        canAttach: true,
        execSql,
      });
      Object.assign(runtime.state, { domainScope: createDomainScope() });
      return openDocumentStore(
        runtime.state.domainScope,
        LOCAL_ID,
        runtime,
        DOCUMENT_ID,
        "",
        "note",
      );
    };
    const loadRow = () =>
      defaultDocumentsPersistence.loadDocument(execSql, LOCAL_ID);
    expect(await openInNewSession().ensureInitialized()).toBe(true);
    const pauses = getOrCreateOrganizationSyncPauses(createDomainScope());
    await pauses.replace(execSql, ["org-paused"]);

    // The pause's cleanup removed the document and recorded why.
    await deletePersistedDocument({
      beforeDeleteInTransaction: (transactionExecSql) =>
        recordPauseRemovedDocument(transactionExecSql, {
          localId: LOCAL_ID,
          organizationId: "org-paused",
        }),
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedRecord: (await loadRow()) ?? undefined,
      localId: LOCAL_ID,
      persistence: defaultDocumentsPersistence,
    });

    // A restarted session has no retired store in memory to fall back on.
    const reopened = openInNewSession();
    await reopened.ensureInitialized();
    expect(reopened.getSnapshot().ready).toBe(false);
    expect(await loadRow()).toBeNull();

    // Once resumed, the same store loads it on its next open.
    await pauses.replace(execSql, []);
    await reopened.ensureInitialized();
    expect(reopened.getSnapshot().ready).toBe(true);
    expect(await loadRow()).not.toBeNull();
  } finally {
    close();
  }
});
