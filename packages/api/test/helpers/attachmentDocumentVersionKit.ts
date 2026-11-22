import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import { authenticate } from "./authenticate";
import { buildBind, stageBlob } from "./blobAttachmentKit";
import type { CreatedDocumentFixture } from "./documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "./documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";
import { postDocumentSync } from "./staleBundleHealKit";

export interface DocumentVersionFixture {
  readonly document: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}

export async function documentWithRoot(): Promise<DocumentVersionFixture> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  return { document: await createDocument({ owner, root }), owner, root };
}

/** Another device's edit: an update from a peer the uploader has not seen. */
export async function commitOtherDeviceUpdate(
  fixture: DocumentVersionFixture,
): Promise<void> {
  const { request } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  const response = await postDocumentSync(
    fixture.owner,
    fixture.document.id,
    request,
  );
  expect(response.status).toBe(200);
}

export async function stagedBind(fixture: DocumentVersionFixture) {
  const blobId = crypto.randomUUID();
  const { binding, request } = await buildBind({
    blobId,
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
    stagedBlob: await stageBlob(fixture.owner, blobId),
  });
  return { binding, blobId, request };
}

export async function boundBlobIds(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, documentId));
  return rows.map((row) => row.blobId);
}

export async function activeBoundBlobIds(
  documentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  return rows.map((row) => row.blobId);
}
