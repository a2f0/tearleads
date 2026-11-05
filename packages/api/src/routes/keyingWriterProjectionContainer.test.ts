import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifests,
  containerKeyEpochs,
} from "@tearleads/api-shared/schema";
import type { KeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import {
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { moveContainer } from "../../test/helpers/keyingWriterProjectionMove";
import { registerUser } from "../../test/helpers/registerUser";
import { decodeServedContainerProjection } from "../../test/helpers/servedWriterProjection";
import {
  type StoredContainerMutation,
  withStoredContainerMutation,
} from "../../test/helpers/storedContainerMutation";
import { routeApp } from "../routeApp";

test("GET /containers/:containerId/writer-projection returns signed path and KEK projection", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = decodeServedContainerProjection(await response.json());
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(body.containerId).toBe(root.kekState.containerId);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash]);
  expect(body.path[0]?.event.eventHash).toBe(
    asVerifiedContainerManifest(root.bundle).event.eventHash,
  );
  expect(body.path[0]?.event.body).toMatchObject({
    eventType: "container.create",
  });
  expect(body.containerKeks).toHaveLength(1);
  expect(body.containerKeks[0]?.containerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection verifies inherited parent KEK edges", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });

  const response = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = decodeServedContainerProjection(await response.json());
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash, child.accessManifest.manifestHash]);
  expect(body.containerKeks).toHaveLength(2);
  expect(body.containerKeks[1]?.parentContainerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection includes historical parent proofs after moving back to root", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const parentA = await createChildContainer({ parent: root, signer: owner });
  const movedChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const parentABundle = await accessManifestFromContainerResponse(parentA);
  const parentAKek = await kekStateFromContainerResponse(parentA);
  const movedChildCreateBundle =
    await accessManifestFromContainerResponse(movedChild);
  const movedUnderParentA = await moveContainer({
    destinationParent: parentABundle,
    destinationParentKekState: parentAKek,
    destinationParentPath: [root.bundle, parentABundle],
    previous: movedChildCreateBundle,
    previousContainerPath: [root.bundle, movedChildCreateBundle],
    previousKekState: await kekStateFromContainerResponse(movedChild),
    signer: owner,
  });
  const movedUnderParentABundle =
    await accessManifestFromContainerResponse(movedUnderParentA);
  const movedBackToRoot = await moveContainer({
    destinationParent: root.bundle,
    destinationParentKekState: root.kekState,
    destinationParentPath: [root.bundle],
    previous: movedUnderParentABundle,
    previousContainerPath: [
      root.bundle,
      parentABundle,
      movedUnderParentABundle,
    ],
    previousKekState: await kekStateFromContainerResponse(movedUnderParentA),
    signer: owner,
  });

  const response = await routeApp.request(
    `/containers/${movedChild.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = decodeServedContainerProjection(await response.json());
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([
    root.bundle.manifestHash,
    (await accessManifestFromContainerResponse(movedBackToRoot)).manifestHash,
  ]);

  const movedChildHistoryHashes =
    body.containerKeks[1]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ) ?? [];
  expect(movedChildHistoryHashes).toContain(
    movedUnderParentABundle.manifestHash,
  );
  expect(movedChildHistoryHashes).toContain(
    movedChildCreateBundle.manifestHash,
  );
  expect(movedChildHistoryHashes).toContain(parentABundle.manifestHash);
});

test("container projections and mutations preserve current KEKs across damaged history", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const firstResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(firstRekey.request),
    },
  );
  expect(firstResponse.status).toBe(200);
  const child = await createChildContainer({
    parent: firstRekey.container,
    signer: owner,
  });

  await db
    .update(containerKeyEpochs)
    .set({ wrappedPredecessorKey: "not-base64" })
    .where(eq(containerKeyEpochs.id, firstRekey.kekState.containerKeyEpochId));

  const rootProjectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(rootProjectionResponse.status).toBe(200);
  const rootProjection = decodeServedContainerProjection(
    await rootProjectionResponse.json(),
  );
  expect(isContainerWriterProjectionResponse(rootProjection)).toBe(true);
  expect(rootProjection.containerKeks[0]).toMatchObject({
    containerKeyEpochId: firstRekey.kekState.containerKeyEpochId,
    keyring: firstRekey.request.keyring,
  });

  const childProjectionResponse = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(childProjectionResponse.status).toBe(200);
  const childProjection = decodeServedContainerProjection(
    await childProjectionResponse.json(),
  );
  expect(isContainerWriterProjectionResponse(childProjection)).toBe(true);
  expect(childProjection.containerKeks).toHaveLength(2);
  expect(childProjection.containerKeks[0]?.keyring).toEqual(
    firstRekey.request
      .keyring as unknown as StoredContainerMutation["containerKek"]["keyring"],
  );
  expect(childProjection.containerKeks[1]?.containerKeyEpochId).toBe(
    child.containerKek.containerKeyEpochId,
  );

  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });
  const secondResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(secondRekey.request),
    },
  );
  expect(secondResponse.status).toBe(200);
  const secondMutationBody = await secondResponse.json();
  expect(isContainerMutationResponse(secondMutationBody)).toBe(true);
  const secondMutation = await withStoredContainerMutation(secondMutationBody);
  expect(secondMutation.containerKek.keyring).toEqual(
    secondRekey.request
      .keyring as StoredContainerMutation["containerKek"]["keyring"],
  );
});

test("GET /containers/:containerId/writer-projection rejects users without read access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  await authenticate(outsider);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${outsider.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
});

test("GET /containers/:containerId/writer-projection rejects malformed stored state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(accessManifests)
    .set({
      state: {
        ...root.bundle.state,
        version: 2,
      } as KeyingCanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /containers/:containerId/writer-projection rejects tampered stored KEK state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(containerKeyEpochs)
    .set({
      accessManifestHash: "0".repeat(64),
    })
    .where(eq(containerKeyEpochs.id, root.kekState.containerKeyEpochId));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});
