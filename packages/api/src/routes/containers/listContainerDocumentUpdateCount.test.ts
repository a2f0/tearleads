import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import type { VerifiedAttachmentBinding } from "@tearleads/crypto";
import { isDocumentSyncResponse } from "@tearleads/validators/response";
import { count, eq } from "drizzle-orm";
import {
  type DocumentVersionFixture,
  documentWithRoot,
  stagedBind,
} from "../../../test/helpers/attachmentDocumentVersionKit";
import {
  bindForTest,
  buildDetach,
  detachForTest,
} from "../../../test/helpers/blobAttachmentKit";
import { listContainerDocumentPage } from "../../../test/helpers/containerDocumentLaneQuery";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

type Watermark = { readonly id: string; readonly updatedAt: string } | null;

/** The lane's rows after `watermark`, and the watermark that follows them. */
async function listLane(fixture: DocumentVersionFixture, watermark: Watermark) {
  const page = await listContainerDocumentPage(fixture.owner.token, {
    containerId: fixture.root.kekState.containerId,
    watermark,
  });
  expect(page.hasMore).toBe(false);
  return {
    row: page.items.find(({ id }) => id === fixture.document.id),
    watermark: page.nextWatermark,
  };
}

async function storedUpdateCount(documentId: string): Promise<number> {
  const [row] = await db
    .select({ updates: count() })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
  return row?.updates ?? 0;
}

/** Commits one content update and returns the count its pull reported. */
async function commitUpdate(fixture: DocumentVersionFixture): Promise<number> {
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
  const body: unknown = await response.json();
  if (!isDocumentSyncResponse(body)) {
    throw new Error("Expected a document sync response");
  }
  return body.pullPage.throughUpdateCount;
}

async function detach(
  fixture: DocumentVersionFixture,
  binding: VerifiedAttachmentBinding,
): Promise<void> {
  await detachForTest({
    binding,
    blobId: binding.blobId,
    owner: fixture.owner,
    request: await buildDetach({
      binding,
      document: fixture.document,
      owner: fixture.owner,
      root: fixture.root,
    }),
  });
}

test("a document listing counts the document's updates as a pull counts them", async () => {
  const fixture = await documentWithRoot();
  const created = await listLane(fixture, null);
  expect(created.row?.updateCount).toBe(
    await storedUpdateCount(fixture.document.id),
  );

  const pulledThrough = await commitUpdate(fixture);
  const edited = await listLane(fixture, created.watermark);
  expect(edited.row?.updateCount).toBe(pulledThrough);
  expect(pulledThrough).toBe((created.row?.updateCount ?? 0) + 1);
}, 20_000);

test("every write a document read would show lists the document again", async () => {
  const fixture = await documentWithRoot();
  let { watermark } = await listLane(fixture, null);
  // Nothing committed since: the lane's delta leaves the document out.
  expect((await listLane(fixture, watermark)).row).toBeUndefined();

  /** Runs one write and returns the count the lane then lists, once. */
  const listedAfter = async (write: () => Promise<unknown>) => {
    await write();
    const listed = await listLane(fixture, watermark);
    if (!listed.row) throw new Error("Expected the write to list the row");
    expect(listed.row.updateCount).toBe(
      await storedUpdateCount(fixture.document.id),
    );
    watermark = listed.watermark;
    expect((await listLane(fixture, watermark)).row).toBeUndefined();
    return listed.row.updateCount;
  };

  const edited = await listedAfter(() => commitUpdate(fixture));
  const bound = await stagedBind(fixture);
  // A bind and a detach change the attachment listing and add no update, so
  // the row comes back with the count the edit left.
  expect(
    await listedAfter(() =>
      bindForTest({
        blobId: bound.blobId,
        owner: fixture.owner,
        request: bound.request,
      }),
    ),
  ).toBe(edited);
  expect(await listedAfter(() => detach(fixture, bound.binding))).toBe(edited);

  // The create and each write above went through the insert trigger: the
  // row's count is the number of updates stored for it.
  const [stored] = await db
    .select({ updateCount: documents.updateCount })
    .from(documents)
    .where(eq(documents.id, fixture.document.id));
  expect(stored?.updateCount).toBe(
    await storedUpdateCount(fixture.document.id),
  );
}, 30_000);
