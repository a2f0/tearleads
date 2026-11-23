import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { inArray } from "drizzle-orm";
import { createChild } from "../../../test/helpers/containerMutationRoutes";
import {
  readContainerParentLanePage,
  requestSingleContainerParentLane,
} from "../../../test/helpers/containerParentLaneQuery";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { countDocumentUpdatesThrough } from "../../documents/documentUpdateStore";

/** One child's listed row. */
async function listedChild(input: {
  childId: string;
  parentId: string;
  token: string;
}) {
  const page = await readContainerParentLanePage(
    await requestSingleContainerParentLane({
      parentId: input.parentId,
      token: input.token,
    }),
  );
  const child = page.items.find(({ id }) => id === input.childId);
  if (!child) throw new Error("Expected the child in its lane");
  return child;
}

/** Stores one opaque update row for `documentId` and returns its sequence. */
async function storeUpdate(documentId: string): Promise<number> {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(documentUpdates)
    .values({
      accessEpoch: 1,
      authorFingerprint: "listing-count-author",
      byteLength: 1,
      documentId,
      encryptedData: "x",
      id,
      partialEndVersionVector: "",
      partialStartVersionVector: "",
      plaintextHash: `plaintext-${id}`,
    })
    .returning({ sequence: documentUpdates.sequence });
  if (!row) throw new Error("Expected the stored update");
  return row.sequence;
}

test("a container listing counts its metadata document's updates as a pull counts them", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const listing = {
    childId: child.containerId,
    parentId: root.kekState.containerId,
    token: owner.token,
  };
  // A create without a metadata seed stores no update.
  const before = await listedChild(listing);
  expect(before.metadataUpdateCount).toBe(0);

  const { metadataDocumentId } = before;
  const otherDocumentId = crypto.randomUUID();
  await storeUpdate(metadataDocumentId);
  await storeUpdate(otherDocumentId);
  const last = await storeUpdate(metadataDocumentId);
  try {
    // Another document's updates are not counted.
    expect((await listedChild(listing)).metadataUpdateCount).toBe(2);
    // A pull bounded at the latest update counts the same updates.
    expect(
      await countDocumentUpdatesThrough(db, {
        documentId: metadataDocumentId,
        sequence: last,
      }),
    ).toBe(2);
  } finally {
    await db
      .delete(documentUpdates)
      .where(
        inArray(documentUpdates.documentId, [
          metadataDocumentId,
          otherDocumentId,
        ]),
      );
  }
});
