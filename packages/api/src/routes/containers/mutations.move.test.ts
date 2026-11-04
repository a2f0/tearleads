import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq, inArray } from "drizzle-orm";
import { buildMoveRequest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  registerAndAuthenticate,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import {
  firstContainerTombstone as firstTombstone,
  requestSingleContainerParentLane as listContainersForUser,
  readContainerParentLanePage as readLanePage,
} from "../../../test/helpers/containerParentLaneQuery";
import { buildGrantRequest } from "../../../test/helpers/containerShareRequests";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";

test("POST /containers/:containerId/move validates destination manifest heads", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const source = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const sourceBundle = accessManifestFromResponse(source);
  const sourceKekState = kekStateFromResponse(source);
  const grandchild = await createChild({
    parent: sourceBundle,
    parentContainerPath: [root.bundle, sourceBundle],
    parentKekState: sourceKekState,
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const preMoveUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await db
    .update(containers)
    .set({ updatedAt: preMoveUpdatedAt })
    .where(
      inArray(containers.id, [source.containerId, grandchild.containerId]),
    );

  const destinationShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(destination),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previousKekState: kekStateFromResponse(destination),
    recipient,
    signer: owner,
  });
  const updatedDestination = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${destination.containerId}/share`,
      request: destinationShareRequest,
      token: owner.token,
    }),
  );

  const staleMoveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(destination),
    destinationParentKekState: kekStateFromResponse(destination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sourceBundle],
    previousKekState: sourceKekState,
    signer: owner,
  });
  const staleResponse = await postMutation({
    path: `/containers/${source.containerId}/move`,
    request: staleMoveRequest,
    token: owner.token,
  });
  expect(staleResponse.status).toBe(409);

  const moveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(updatedDestination),
    destinationParentKekState: kekStateFromResponse(updatedDestination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(updatedDestination),
    ],
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sourceBundle],
    previousKekState: sourceKekState,
    signer: owner,
  });
  const moved = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${source.containerId}/move`,
      request: moveRequest,
      token: owner.token,
    }),
  );

  expect(moved.parentId).toBe(destination.containerId);
  expect(moved.containerKek.parentContainerKeyEpochId).toBe(
    updatedDestination.containerKek.containerKeyEpochId,
  );

  const movedRows = await db
    .select({
      depth: containers.depth,
      id: containers.id,
      parentId: containers.parentId,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(
      inArray(containers.id, [
        destination.containerId,
        source.containerId,
        grandchild.containerId,
      ]),
    );
  const movedRowsById = new Map(movedRows.map((row) => [row.id, row]));
  expect(movedRowsById.get(destination.containerId)).toMatchObject({
    depth: 1,
    parentId: root.kekState.containerId,
  });
  expect(movedRowsById.get(source.containerId)).toMatchObject({
    depth: 2,
    parentId: destination.containerId,
  });
  expect(movedRowsById.get(grandchild.containerId)).toMatchObject({
    depth: 3,
    parentId: source.containerId,
  });

  const movedSourceUpdatedAt = movedRowsById
    .get(source.containerId)
    ?.updatedAt.toISOString();
  const movedGrandchildUpdatedAt = movedRowsById
    .get(grandchild.containerId)
    ?.updatedAt.toISOString();
  expect(movedSourceUpdatedAt).toBe(movedGrandchildUpdatedAt);
  expect(movedSourceUpdatedAt).not.toBe(preMoveUpdatedAt.toISOString());
});

test("POST /containers/:containerId/move relocates a folder into a system (Trash) container and back out", async () => {
  // The client "Move to Trash" folder action is a container move whose
  // destination is the Trash system container. The move workflow only guards the
  // MOVED container's system slot (a system container itself cannot be moved); it
  // deliberately does NOT guard the destination's slot, so a normal folder can be
  // re-parented under Trash. This locks that in — a destination-slot guard would
  // silently break folder trashing — and confirms the round trip (restore) works.
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const trash = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  // Stamp the destination as a system container. The slot is a server-opaque
  // column, not part of the signed manifest, so the move request built against
  // trash's manifest stays valid.
  const trashSystemSlot = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await db
    .update(containers)
    .set({ systemSlot: trashSystemSlot })
    .where(eq(containers.id, trash.containerId));
  const folder = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const restoreTarget = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const trashBundle = accessManifestFromResponse(trash);
  const trashKekState = kekStateFromResponse(trash);

  const moveIntoTrash = await buildMoveRequest({
    destinationParent: trashBundle,
    destinationParentKekState: trashKekState,
    destinationParentPath: [root.bundle, trashBundle],
    previous: accessManifestFromResponse(folder),
    previousContainerPath: [root.bundle, accessManifestFromResponse(folder)],
    previousKekState: kekStateFromResponse(folder),
    signer: owner,
  });
  const trashed = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${folder.containerId}/move`,
      request: moveIntoTrash,
      token: owner.token,
    }),
  );
  expect(trashed.parentId).toBe(trash.containerId);

  const [trashedRow] = await db
    .select({ depth: containers.depth, parentId: containers.parentId })
    .from(containers)
    .where(eq(containers.id, folder.containerId));
  expect(trashedRow).toMatchObject({ depth: 2, parentId: trash.containerId });

  // Restore: move the trashed folder back out to a normal folder. Content under a
  // system container is not pinned there, so the same move endpoint pulls it back.
  const restoreTargetBundle = accessManifestFromResponse(restoreTarget);
  const restoreOut = await buildMoveRequest({
    destinationParent: restoreTargetBundle,
    destinationParentKekState: kekStateFromResponse(restoreTarget),
    destinationParentPath: [root.bundle, restoreTargetBundle],
    previous: accessManifestFromResponse(trashed),
    previousContainerPath: [
      root.bundle,
      trashBundle,
      accessManifestFromResponse(trashed),
    ],
    previousKekState: kekStateFromResponse(trashed),
    signer: owner,
  });
  const restored = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${folder.containerId}/move`,
      request: restoreOut,
      token: owner.token,
    }),
  );
  expect(restored.parentId).toBe(restoreTarget.containerId);
});

test("POST /containers/:containerId/move emits tombstones when inherited access is lost", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const oldParent = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const oldParentShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(oldParent),
    previousContainerPath: [root.bundle, accessManifestFromResponse(oldParent)],
    previousKekState: kekStateFromResponse(oldParent),
    recipient,
    signer: owner,
  });
  const sharedOldParent = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${oldParent.containerId}/share`,
      request: oldParentShareRequest,
      token: owner.token,
    }),
  );
  const sharedOldParentBundle = accessManifestFromResponse(sharedOldParent);
  const sharedOldParentKekState = kekStateFromResponse(sharedOldParent);
  const source = await createChild({
    parent: sharedOldParentBundle,
    parentContainerPath: [root.bundle, sharedOldParentBundle],
    parentKekState: sharedOldParentKekState,
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const recipientBaselineResponse = await listContainersForUser({
    parentId: oldParent.containerId,
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(source.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: source.containerId,
    updatedAt: expect.any(String),
  });

  const sourceBundle = accessManifestFromResponse(source);
  const moveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(destination),
    destinationParentKekState: kekStateFromResponse(destination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sharedOldParentBundle, sourceBundle],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });

  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${source.containerId}/move`,
      request: moveRequest,
      token: owner.token,
    }),
  );

  const recipientDeltaResponse = await listContainersForUser({
    parentId: oldParent.containerId,
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(source.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: source.containerId,
      depth: 2,
      parentId: oldParent.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
  expect(recipientDelta.nextWatermark).toEqual({
    id: source.containerId,
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });
});
