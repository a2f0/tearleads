import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../test/helpers/workflows/rotationRecoveryRuntime";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import {
  addDocumentAttachments,
  serializeDocumentAttachmentNames,
} from "../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { waitForDomainSyncCoordinatorToSettle } from "../../data/sync/syncCoordinator";
import type { HydratedDocumentAttachmentBlob } from "../../workflows/blobs";
import { createContainerDocumentQueriesFromRuntime } from "../../workflows/container-contents/documentQueries";
import { getOrCreateDocumentStore } from "./documentStore";
import { createRemoteHistoryFixture } from "./documentStore/documentStore.testFixtures";
import { retryDocumentDownload } from "./downloadRetry";
import type { DocumentsRuntime } from "./types";

const PHOTO = {
  byteLength: 3,
  contentSha256: "e".repeat(64),
  mimeType: "image/png",
  name: "drill.png",
  slotId: "photos:1",
};

async function createReader(name: string) {
  const database = await createTestExecSql(name);
  const fixture = await createRemoteHistoryFixture();
  const documentId = fixture.writerProjection.documentId;
  addDocumentAttachments(fixture.remoteDocument, [PHOTO]);
  await sqlDocumentsPersistence.ensureSchema(database.execSql);
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId,
    execSql: database.execSql,
    localId: "drill",
  });
  await database.execSql(
    "UPDATE document_projection_text SET attachment_names = ? WHERE local_id = 'drill'",
    [serializeDocumentAttachmentNames(fixture.remoteDocument)],
  );
  const base = createRotationRecoveryRuntime({
    execSql: database.execSql,
    fixture,
    requireRawHistory: false,
    responseForRequest: async (_request, response) => ({
      ...response,
      updates: [],
    }),
  });
  const hydrations: string[] = [];
  let published = false;
  // The service is a class instance; override its method in place.
  base.blobAttachments.hydrateDocumentAttachmentBlobs = async (request) => {
    hydrations.push(request.documentId);
    request.onBindingsChecked?.();
    if (!published) return [];
    const attachment = request.attachments.find(
      (candidate) => candidate.slotId === PHOTO.slotId,
    );
    if (!attachment) return [];
    const hydrated = {
      attachment,
      binding: { blobId: "drill-photo" },
      bytes: new Uint8Array([1, 2, 3]),
      contentSha256: PHOTO.contentSha256,
      intentMismatch: false,
      storageKey: "blob-drill-photo",
    };
    return [hydrated as unknown as HydratedDocumentAttachmentBlob];
  };
  const logs: string[] = [];
  const runtime: DocumentsRuntime = {
    ...base,
    infra: { ...base.infra, blobStore: createMemoryBlobStore() },
    util: { ...base.util, log: (message) => logs.push(message) },
  };
  const queries = createContainerDocumentQueriesFromRuntime({
    infra: { execSql: database.execSql },
  });
  return {
    ...database,
    documentId,
    fixture,
    hydrations,
    logs,
    publish: () => {
      published = true;
    },
    queries,
    runtime,
    retry: (requestedDocumentId: string) =>
      retryDocumentDownload({
        documentId: requestedDocumentId,
        localId: "drill",
        workflowRuntime: () => runtime,
      }),
  };
}

test("retrying a pending first download fetches the file once it is bound", async () => {
  const reader = await createReader("download-retry");
  try {
    expect(await reader.queries.listPendingDownloads()).toMatchObject([
      { fileName: PHOTO.name, objectKind: "attachment", slotId: PHOTO.slotId },
    ]);

    // The writer has not bound the file yet: the retry checks and finds none.
    expect(await reader.retry(reader.documentId)).toBe(true);
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(reader.hydrations).toEqual([reader.documentId]);
    expect(await reader.queries.listPendingDownloads()).toHaveLength(1);

    reader.publish();
    expect(await reader.retry(reader.documentId)).toBe(true);
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(reader.hydrations).toEqual([reader.documentId, reader.documentId]);
    expect(await reader.queries.listPendingDownloads()).toEqual([]);
    expect(
      await reader.runtime.infra.blobStore.readBytes("blob-drill-photo"),
    ).toEqual(new Uint8Array([1, 2, 3]));
  } finally {
    reader.fixture.remoteDocument.free();
    reader.close();
  }
});

test("a retry read before a relink does nothing to the relinked record", async () => {
  const reader = await createReader("download-retry-stale");
  try {
    expect(await reader.retry("previous-document")).toBe(false);
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(reader.hydrations).toEqual([]);
  } finally {
    reader.fixture.remoteDocument.free();
    reader.close();
  }
});

test("a retry reuses an open editor's store and keeps its draft", async () => {
  const reader = await createReader("download-retry-open-editor");
  try {
    const editor = getOrCreateDocumentStore(
      reader.runtime.state.domainScope,
      "drill",
      reader.runtime,
      reader.documentId,
    );
    expect(await editor.ensureInitialized()).toBe(true);
    await editor.setText("unsaved draft");
    reader.publish();
    expect(await reader.retry(reader.documentId)).toBe(true);
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(
      getOrCreateDocumentStore(
        reader.runtime.state.domainScope,
        "drill",
        reader.runtime,
      ),
    ).toBe(editor);
    expect(editor.getSnapshot().text).toBe("unsaved draft");
    expect(await reader.queries.listPendingDownloads()).toEqual([]);
  } finally {
    reader.fixture.remoteDocument.free();
    reader.close();
  }
});

test("a retry of a store a listing opened on demand runs only its own pull", async () => {
  const reader = await createReader("download-retry-on-demand");
  try {
    const listed = getOrCreateDocumentStore(
      reader.runtime.state.domainScope,
      "drill",
      reader.runtime,
      reader.documentId,
      "",
      undefined,
      { remoteSyncMode: "on-demand" },
    );
    expect(await listed.ensureInitialized()).toBe(true);
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(reader.hydrations).toEqual([]);

    reader.publish();
    expect(await reader.retry(reader.documentId)).toBe(true);
    await Promise.resolve();
    await waitForDomainSyncCoordinatorToSettle(
      reader.runtime.state.domainScope,
    );
    expect(reader.hydrations).toEqual([reader.documentId]);
    expect(await reader.queries.listPendingDownloads()).toEqual([]);
    // The retry pulls once; it does not also schedule a startup probe.
    expect(reader.logs).not.toContain(
      "Documents: remote revalidation scheduled reason=startup",
    );
  } finally {
    reader.fixture.remoteDocument.free();
    reader.close();
  }
});
