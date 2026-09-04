import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { VerifiedContainerKekState } from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../test/helpers/containerGrantMutation";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

// A container manifest pins the parent manifest it was created under, and
// that pin lags once the parent's head advances. A mutation on the child is
// authorized against the current heads and cites them in its event, so it
// must still be accepted, and the projections must serve the cited heads,
// which end up neither on the current path nor pinned by any manifest.

interface StoredContainer {
  readonly bundle: AccessManifestBundleWire;
  readonly containerId: string;
  readonly kekState: VerifiedContainerKekState;
}

function storedContainer(response: unknown): StoredContainer {
  if (!isContainerMutationResponse(response)) {
    throw new Error("Expected a container mutation response");
  }
  return {
    bundle: response.accessManifest as AccessManifestBundleWire,
    containerId: response.containerId,
    kekState: response.containerKek as unknown as VerifiedContainerKekState,
  };
}

async function shareContainer(input: {
  readonly container: StoredContainer;
  readonly history?: readonly AccessManifestBundleWire[] | undefined;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly path: readonly AccessManifestBundleWire[];
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<StoredContainer> {
  const request = await buildContainerGrantRequest({
    accessLevel: "read",
    containerManifestHistory: input.history,
    parentKekState: input.parentKekState,
    previous: input.container.bundle,
    previousContainerPath: [...input.path, input.container.bundle],
    previousKekState: input.container.kekState,
    recipient: input.recipient,
    signer: input.signer,
  });
  const response = await routeApp.request(
    `/containers/${input.container.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.signer.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return storedContainer(await response.json());
}

async function createLineage(root: StoredRootFixture, owner: TestUser) {
  const reader = createTestUser();
  const secondReader = createTestUser();
  for (const user of [reader, secondReader]) {
    await registerUser(user);
    await authenticate(user);
  }
  const rootContainer: StoredContainer = {
    bundle: root.bundle,
    containerId: root.kekState.containerId,
    kekState: root.kekState,
  };
  const parent1 = storedContainer(
    await createChildContainer({ parent: root, signer: owner }),
  );
  const child1 = storedContainer(
    await createChildContainer({
      parent: { bundle: parent1.bundle, kekState: parent1.kekState },
      parentPath: [rootContainer.bundle],
      signer: owner,
    }),
  );
  // The parent advances; the child's next event is committed against it.
  const parent2 = await shareContainer({
    container: parent1,
    parentKekState: root.kekState,
    path: [rootContainer.bundle],
    recipient: reader,
    signer: owner,
  });
  const child2 = await shareContainer({
    container: child1,
    parentKekState: parent2.kekState,
    path: [rootContainer.bundle, parent2.bundle],
    recipient: reader,
    signer: owner,
  });
  // The parent advances again, so the head the child cited is neither on
  // the current path nor the child's creation-time pin. The parent's KEK
  // epoch still binds to its creation manifest, which the history serves.
  const parent3 = await shareContainer({
    container: parent2,
    history: [parent1.bundle],
    parentKekState: root.kekState,
    path: [rootContainer.bundle],
    recipient: secondReader,
    signer: owner,
  });
  return { child1, child2, parent1, parent2, parent3, rootContainer };
}

test("a child can be shared after its parent's head advanced", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const lineage = await createLineage(root, owner);
  expect(lineage.child2.bundle.manifestHash).not.toBe(
    lineage.child1.bundle.manifestHash,
  );
});

test("GET /containers/:containerId/writer-projection serves the ancestor heads a child event cites", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const { child1, child2, parent1, parent2, parent3, rootContainer } =
    await createLineage(root, owner);

  const response = await routeApp.request(
    `/containers/${child1.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );

  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([
    rootContainer.bundle.manifestHash,
    parent3.bundle.manifestHash,
    child2.bundle.manifestHash,
  ]);
  const childHistoryHashes =
    body.containerKeks[2]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ) ?? [];
  expect(childHistoryHashes).toContain(parent2.bundle.manifestHash);
  expect(childHistoryHashes).toContain(parent1.bundle.manifestHash);
  expect(childHistoryHashes).toContain(child1.bundle.manifestHash);
});

test("GET /documents/:documentId/writer-projection serves the ancestor heads its container events cite", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const { child2, parent2, parent3, rootContainer } = await createLineage(
    root,
    owner,
  );
  const document = await createDocument({
    containerPath: [rootContainer.bundle, parent3.bundle, child2.bundle],
    owner,
    root: {
      bundle: child2.bundle,
      kekState: child2.kekState,
      principalPolicies: root.principalPolicies,
    },
  });

  const response = await routeApp.request(
    `/documents/${document.id}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );

  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  expect(isDocumentWriterProjectionResponse(body)).toBe(true);
  const historyHashes = body.documentContainerManifestHistory.map(
    (entry: { manifestHash: string }) => entry.manifestHash,
  );
  expect(historyHashes).toContain(parent2.bundle.manifestHash);
});
