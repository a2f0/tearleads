import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdateSpans } from "@tearleads/api-shared/schema";
import { decodeVersionVector } from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { createChild } from "../../../test/helpers/containerMutationRoutes";
import {
  readContainerParentLanePage,
  requestSingleContainerParentLane,
} from "../../../test/helpers/containerParentLaneQuery";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

/** One child's listed row, with its metadata version as peer counters. */
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
  return {
    metadataDocumentId: child.metadataDocumentId,
    version: Object.fromEntries(
      decodeVersionVector(child.metadataVersionVector).toJSON(),
    ),
  };
}

test("a container listing reports the highest counter per peer of its metadata updates", async () => {
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
  expect(before.version).toEqual({});

  const { metadataDocumentId } = before;
  await db.insert(documentUpdateSpans).values([
    {
      documentId: metadataDocumentId,
      endCounter: 3,
      peerId: "11",
      startCounter: 0,
      updateId: crypto.randomUUID(),
    },
    {
      documentId: metadataDocumentId,
      endCounter: 7,
      peerId: "11",
      startCounter: 3,
      updateId: crypto.randomUUID(),
    },
    {
      documentId: metadataDocumentId,
      endCounter: 2,
      peerId: "22",
      startCounter: 0,
      updateId: crypto.randomUUID(),
    },
  ]);
  expect((await listedChild(listing)).version).toEqual({ "11": 7, "22": 2 });

  await db
    .delete(documentUpdateSpans)
    .where(eq(documentUpdateSpans.documentId, metadataDocumentId));
});
