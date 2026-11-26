import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  readContainerParentLanePage,
  requestSingleContainerParentLane,
} from "../../../test/helpers/containerParentLaneQuery";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

/** Lists the root lane to its end from `watermark` and returns the last page. */
async function listRootLane(
  token: string,
  watermark: { readonly id: string; readonly updatedAt: string } | null,
) {
  const response = await requestSingleContainerParentLane({ token, watermark });
  expect(response.status).toBe(200);
  const page = await readContainerParentLanePage(response);
  expect(page.hasMore).toBe(false);
  return page;
}

test("a document purge republishes its container in the lane that serves it", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  // A client that has listed everything, the create included.
  const listed = await listRootLane(owner.token, null);
  expect(listed.items.map((item) => item.id)).toContain(owner.rootContainerId);
  const watermark = listed.nextWatermark;
  if (!watermark) throw new Error("Expected a root lane watermark");
  expect((await listRootLane(owner.token, watermark)).items).toEqual([]);

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
  });
  expect(response.status).toBe(200);

  // The purge leaves a tombstone in the container's document lane. A client
  // that lost its hint finds the container's row past its watermark, which
  // is what tells it the document lane moved.
  const afterPurge = await listRootLane(owner.token, watermark);
  expect(afterPurge.items.map((item) => item.id)).toEqual([
    owner.rootContainerId,
  ]);
});
