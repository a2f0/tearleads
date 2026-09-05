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
import { moveContainer } from "../../test/helpers/keyingWriterProjectionMove";
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

interface ShareInput {
  readonly accessLevel?: "read" | "write" | undefined;
  readonly container: StoredContainer;
  readonly history?: readonly AccessManifestBundleWire[] | undefined;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly path: readonly AccessManifestBundleWire[];
  readonly recipient: TestUser;
  readonly signer: TestUser;
}

async function postShare(input: ShareInput): Promise<Response> {
  const request = await buildContainerGrantRequest({
    accessLevel: input.accessLevel ?? "read",
    containerManifestHistory: input.history,
    parentKekState: input.parentKekState,
    previous: input.container.bundle,
    previousContainerPath: [...input.path, input.container.bundle],
    previousKekState: input.container.kekState,
    recipient: input.recipient,
    signer: input.signer,
  });
  return routeApp.request(`/containers/${input.container.containerId}/share`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.signer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

async function shareContainer(input: ShareInput): Promise<StoredContainer> {
  const response = await postShare(input);
  expect(response.status, await response.clone().text()).toBe(200);
  return storedContainer(await response.json());
}

async function registerReader(): Promise<TestUser> {
  const reader = createTestUser();
  await registerUser(reader);
  await authenticate(reader);
  return reader;
}

async function createLineage(root: StoredRootFixture, owner: TestUser) {
  const reader = await registerReader();
  const secondReader = await registerReader();
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
  return {
    child1,
    child2,
    parent1,
    parent2,
    parent3,
    reader,
    rootContainer,
  };
}

async function loadContainerProjection(
  containerId: string,
  owner: TestUser,
): Promise<{ readonly kekHistories: string[][]; readonly path: string[] }> {
  const response = await routeApp.request(
    `/containers/${containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  return {
    kekHistories: body.containerKeks.map(
      (kek: {
        containerManifestHistory?: { manifestHash: string }[] | undefined;
      }) =>
        kek.containerManifestHistory?.map((entry) => entry.manifestHash) ?? [],
    ),
    path: body.path.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  };
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
  expect(lineage.child2.bundle).toMatchObject({
    event: {
      event: {
        dependencyManifestHashes: expect.arrayContaining([
          lineage.parent2.bundle.manifestHash,
        ]),
      },
    },
  });
});

test("a document authored through a newer parent grant verifies from its signed citations", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const bob = await registerReader();
  const root = await bootstrapRoot(owner);
  const parent1 = storedContainer(
    await createChildContainer({ parent: root, signer: owner }),
  );
  const child1 = storedContainer(
    await createChildContainer({
      parent: { bundle: parent1.bundle, kekState: parent1.kekState },
      parentPath: [root.bundle],
      signer: owner,
    }),
  );
  const parent2 = await shareContainer({
    accessLevel: "write",
    container: parent1,
    parentKekState: root.kekState,
    path: [root.bundle],
    recipient: bob,
    signer: owner,
  });
  expect(Reflect.get(child1.bundle.state, "parentManifestHash")).toBe(
    parent1.bundle.manifestHash,
  );
  const document = await createDocument({
    containerPath: [root.bundle, parent2.bundle, child1.bundle],
    owner: bob,
    root: {
      bundle: child1.bundle,
      kekState: child1.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  expect(document.accessManifest).toMatchObject({
    event: {
      event: {
        dependencyManifestHashes: expect.arrayContaining([
          root.bundle.manifestHash,
          parent2.bundle.manifestHash,
          child1.bundle.manifestHash,
        ]),
      },
    },
  });
  // The signed parent2 must remain available even after it leaves the current
  // path; the child's creation-time pin still names parent1.
  await shareContainer({
    container: parent2,
    history: [parent1.bundle],
    parentKekState: root.kekState,
    path: [root.bundle],
    recipient: await registerReader(),
    signer: owner,
  });
  const response = await routeApp.request(
    `/documents/${document.id}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${bob.token}` },
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const projection: unknown = await response.json();
  if (!isDocumentWriterProjectionResponse(projection))
    throw new Error("Expected writer projection");
  const served = new Set(
    [
      ...projection.documentContainerManifestHistory,
      ...projection.documentManifestContainerPaths.flat(),
    ].map((bundle) => bundle.manifestHash),
  );
  expect(served.has(parent2.bundle.manifestHash)).toBe(true);
  expect(projection.documentManifest.manifestHash).toBe(
    document.accessManifest.manifestHash,
  );
});

test("POST /containers/:containerId/share refuses a path that does not start at a root", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const parent = storedContainer(
    await createChildContainer({ parent: root, signer: owner }),
  );
  const child = storedContainer(
    await createChildContainer({
      parent: { bundle: parent.bundle, kekState: parent.kekState },
      parentPath: [root.bundle],
      signer: owner,
    }),
  );

  // Every element is a current head and every edge matches, so only the
  // missing root distinguishes this path from a valid one. Accepting it
  // would commit a head whose citations cannot rebuild its ancestry.
  const response = await postShare({
    container: child,
    parentKekState: parent.kekState,
    path: [parent.bundle],
    recipient: await registerReader(),
    signer: owner,
  });

  expect(response.status).toBe(409);
  expect(await response.text()).toContain("does not start at a root container");
});

test("GET /containers/:containerId/writer-projection serves the ancestor heads a child event cites", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const { child1, child2, parent1, parent2, parent3, rootContainer } =
    await createLineage(root, owner);

  const projection = await loadContainerProjection(child1.containerId, owner);

  expect(projection.path).toEqual([
    rootContainer.bundle.manifestHash,
    parent3.bundle.manifestHash,
    child2.bundle.manifestHash,
  ]);
  const childHistory = projection.kekHistories[2] ?? [];
  expect(childHistory).toContain(parent2.bundle.manifestHash);
  expect(childHistory).toContain(parent1.bundle.manifestHash);
  expect(childHistory).toContain(child1.bundle.manifestHash);
});

test("a child can be moved after its parent's head advanced and its projection serves the cited source ancestors", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const reader = await registerReader();
  const parent1 = storedContainer(
    await createChildContainer({ parent: root, signer: owner }),
  );
  const child = storedContainer(
    await createChildContainer({
      parent: { bundle: parent1.bundle, kekState: parent1.kekState },
      parentPath: [root.bundle],
      signer: owner,
    }),
  );
  const destination = storedContainer(
    await createChildContainer({ parent: root, signer: owner }),
  );
  const parent2 = await shareContainer({
    container: parent1,
    parentKekState: root.kekState,
    path: [root.bundle],
    recipient: reader,
    signer: owner,
  });

  // The source path is the current one, which the child never pinned.
  const moved = storedContainer(
    await moveContainer({
      destinationParent: destination.bundle,
      destinationParentKekState: destination.kekState,
      destinationParentPath: [root.bundle, destination.bundle],
      previous: child.bundle,
      previousContainerPath: [root.bundle, parent2.bundle, child.bundle],
      previousKekState: child.kekState,
      signer: owner,
    }),
  );
  // A further event re-verifies the stored move, whose source ancestors and
  // destination path come from its citations rather than from any pin.
  const shared = await shareContainer({
    container: moved,
    parentKekState: destination.kekState,
    path: [root.bundle, destination.bundle],
    recipient: reader,
    signer: owner,
  });

  const projection = await loadContainerProjection(child.containerId, owner);

  expect(projection.path).toEqual([
    root.bundle.manifestHash,
    destination.bundle.manifestHash,
    shared.bundle.manifestHash,
  ]);
  const childHistory = projection.kekHistories[2] ?? [];
  expect(childHistory).toContain(moved.bundle.manifestHash);
  expect(childHistory).toContain(parent2.bundle.manifestHash);
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
