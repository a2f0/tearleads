import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { inArray } from "drizzle-orm";
import { buildMoveRequest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

test("a move from a trailing clock still advances every moved row and reports the stored time", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const source = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const sourceBundle = accessManifestFromResponse(source);
  const grandchild = await createChild({
    parent: sourceBundle,
    parentContainerPath: [root.bundle, sourceBundle],
    parentKekState: kekStateFromResponse(source),
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  // An instance whose clock leads this one last wrote both rows.
  const leadingClock = new Date(Date.now() + 60 * 60 * 1000);
  const movedIds = [source.containerId, grandchild.containerId];
  await db
    .update(containers)
    .set({ updatedAt: leadingClock })
    .where(inArray(containers.id, movedIds));

  const moved = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${source.containerId}/move`,
      request: await buildMoveRequest({
        destinationParent: accessManifestFromResponse(destination),
        destinationParentKekState: kekStateFromResponse(destination),
        destinationParentPath: [
          root.bundle,
          accessManifestFromResponse(destination),
        ],
        previous: sourceBundle,
        previousContainerPath: [root.bundle, sourceBundle],
        previousKekState: kekStateFromResponse(source),
        signer: owner,
      }),
      token: owner.token,
    }),
  );

  const rows = await db
    .select({ id: containers.id, updatedAt: containers.updatedAt })
    .from(containers)
    .where(inArray(containers.id, movedIds));
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.updatedAt.getTime()).toBeGreaterThan(leadingClock.getTime());
  }
  const stored = rows.find((row) => row.id === source.containerId);
  if (!stored) throw new Error("Expected the moved row");
  expect(moved.updatedAt).toBe(stored.updatedAt.toISOString());
});
