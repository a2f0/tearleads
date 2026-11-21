import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../test/helpers/workflows/rotationRecoveryRuntime";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { addDocumentAttachments } from "../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { waitForDomainSyncCoordinatorToSettle } from "../../data/sync/syncCoordinator";
import type {
  HydrateDocumentAttachmentBlobsRequest,
  HydratedDocumentAttachmentBlob,
} from "../../workflows/blobs";
import { getOrCreateDocumentStore } from "./documentStore";
import { createRemoteHistoryFixture } from "./documentStore/documentStore.testFixtures";
import type { DocumentsRuntime } from "./types";

const PANE_B_DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO = {
  byteLength: 3,
  contentSha256: "f".repeat(64),
  mimeType: "image/png",
  name: "saw.png",
  slotId: "photo",
};

function hydratedPhoto(
  request: HydrateDocumentAttachmentBlobsRequest,
): HydratedDocumentAttachmentBlob[] {
  const attachment = request.attachments.find(
    (candidate) => candidate.slotId === PHOTO.slotId,
  );
  if (!attachment) return [];
  const hydrated = {
    attachment,
    binding: { blobId: "saw-photo" },
    bytes: new Uint8Array([7, 8, 9]),
    contentSha256: PHOTO.contentSha256,
    intentMismatch: false,
    storageKey: "blob-saw-photo",
  };
  return [hydrated as unknown as HydratedDocumentAttachmentBlob];
}

async function settle(runtime: DocumentsRuntime) {
  await waitForDomainSyncCoordinatorToSettle(runtime.state.domainScope);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitForDomainSyncCoordinatorToSettle(runtime.state.domainScope);
}

test("a relink from another pane leaves the open editor on its own record", async () => {
  const { execSql, close } = await createTestExecSql("relinked-view");
  const fixture = await createRemoteHistoryFixture();
  try {
    const documentId = fixture.writerProjection.documentId;
    addDocumentAttachments(fixture.remoteDocument, [PHOTO]);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    for (const [localId, id] of [
      ["pane-a", documentId],
      ["pane-b", PANE_B_DOCUMENT_ID],
    ] as const) {
      await persistFullHistoryDocument({
        doc: fixture.remoteDocument,
        documentId: id,
        execSql,
        localId,
      });
    }
    const base = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (_request, response) => ({
        ...response,
        updates: [],
      }),
    });
    // Pane A's first download of the photo is outstanding when the relink
    // lands; every later request completes at once.
    let releaseOutstanding: (() => void) | null = null;
    let outstanding: HydrateDocumentAttachmentBlobsRequest | null = null;
    const outstandingStarted = Promise.withResolvers<void>();
    const hydrations: HydrateDocumentAttachmentBlobsRequest[] = [];
    base.blobAttachments.hydrateDocumentAttachmentBlobs = async (request) => {
      hydrations.push(request);
      if (!outstanding) {
        outstanding = request;
        const released = Promise.withResolvers<void>();
        releaseOutstanding = released.resolve;
        outstandingStarted.resolve();
        await released.promise;
      }
      if (request.stillCurrent?.() === false) return [];
      return hydratedPhoto(request);
    };
    const runtime: DocumentsRuntime = {
      ...base,
      infra: { ...base.infra, blobStore: createMemoryBlobStore() },
    };
    const scope = runtime.state.domainScope;

    const paneA = getOrCreateDocumentStore(
      scope,
      "pane-a",
      runtime,
      documentId,
    );
    expect(await paneA.ensureInitialized()).toBe(true);
    paneA.requestRemoteSync();
    await outstandingStarted.promise;
    await paneA.setText("pane A draft");
    // An upload pane A started before the relink.
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 4,
      contentSha256: "a".repeat(64),
      localId: "pane-a",
      mimeType: "image/jpeg",
      name: "receipt.jpg",
      slotId: "receipt",
      storageKey: "local-receipt",
    });

    const paneB = getOrCreateDocumentStore(
      scope,
      "pane-b",
      runtime,
      PANE_B_DOCUMENT_ID,
    );
    expect(await paneB.ensureInitialized()).toBe(true);
    await paneB.setText("pane B text");
    expect(
      await paneB.relink({
        accessEpoch: 1,
        containerId: "source-container",
        documentId,
        localId: "pane-b",
      }),
    ).toMatchObject({ documentId, id: "pane-b" });

    // Pane A keeps showing its own draft, read-only, with a reopen prompt.
    expect(paneA.getSnapshot()).toMatchObject({
      canAttach: false,
      canWrite: false,
      relinkedElsewhere: true,
      text: "pane A draft",
    });
    expect(paneB.getSnapshot().text).toBe("pane B text");
    expect(paneB.getSnapshot().relinkedElsewhere).toBeUndefined();

    // Its stale download finishes without landing in either record.
    const stale = outstanding as HydrateDocumentAttachmentBlobsRequest | null;
    expect(stale?.stillCurrent?.()).toBe(false);
    (releaseOutstanding as (() => void) | null)?.();
    await settle(runtime);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(execSql, "pane-a"),
    ).toEqual([]);

    // Each draft and file stays with the record that made it.
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, "pane-a"))?.text,
    ).toBe("pane A draft");
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, "pane-b"))?.text,
    ).toBe("pane B text");
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, "pane-a"),
    ).toMatchObject([{ slotId: "receipt", storageKey: "local-receipt" }]);
    expect(
      await sqlDocumentsPersistence.listPendingAttachments(execSql, "pane-b"),
    ).toEqual([]);

    // Reopening pane A's record shows the document's new owner.
    const reopened = getOrCreateDocumentStore(
      scope,
      "pane-a",
      runtime,
      documentId,
    );
    expect(reopened).toBe(paneB);
    expect(reopened.getSnapshot().text).toBe("pane B text");

    // Closing pane A cancels nothing pane B owns: its download completes.
    const before = hydrations.length;
    paneB.requestRemoteSync();
    await settle(runtime);
    expect(hydrations.length).toBeGreaterThan(before);
    expect(
      await sqlDocumentsPersistence.listLocalAttachments(execSql, "pane-b"),
    ).toMatchObject([{ slotId: PHOTO.slotId, storageKey: "blob-saw-photo" }]);
  } finally {
    fixture.remoteDocument.free();
    close();
  }
});
