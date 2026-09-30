import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { createContainerDepthFixture } from "../../test/helpers/containerDepthFixture";
import { buildChildCreateRequest } from "../../test/helpers/containerMutationArtifactKit";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import { kekStateFromContainerResponse } from "../../test/helpers/keyingWriterProjectionKit";
import { buildContainerMoveRequest } from "../../test/helpers/keyingWriterProjectionMove";
import { routeApp } from "../routeApp";

let fixture: Awaited<ReturnType<typeof createContainerDepthFixture>>;
beforeAll(async () => {
  fixture = await createContainerDepthFixture(99);
}, 180_000);

function submit(path: string, request: ContainerMutationRequest) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fixture.owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

/** The structural row a refused mutation must leave untouched. */
async function loadStructure(containerId: string) {
  const [row] = await db
    .select({ depth: containers.depth, parentId: containers.parentId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  return row ?? null;
}

/** The mutation guard's coded refusal, distinct from the readers' checks. */
async function expectPathTooDeep(response: Response) {
  expect(response.status, await response.clone().text()).toBe(409);
  await expect(response.json()).resolves.toEqual({
    code: CONTAINER_MUTATION_ERROR_CODES.pathTooDeep,
    error: "Container path exceeds maximum depth",
  });
}

async function assertReadable(containerId: string) {
  const response = await routeApp.request(
    `/containers/${containerId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${fixture.owner.token}` },
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

test("create refuses a child beyond the readable path depth", async () => {
  const parent = fixture.chain.at(-1);
  if (!parent) throw new Error("Missing deepest parent");
  await assertReadable(parent.kekState.containerId);
  const request = await buildChildCreateRequest({
    root: parent,
    parentPath: fixture.chain.slice(0, -1).map((entry) => entry.bundle),
    signer: fixture.owner,
  });
  const response = await submit("/containers", request);
  await expectPathTooDeep(response);
  const containerId = Reflect.get(request.manifest, "objectId");
  if (typeof containerId !== "string") throw new Error("Missing container id");
  await expect(loadStructure(containerId)).resolves.toBeNull();
}, 30_000);

test("move refuses a leaf beyond the readable path depth", async () => {
  const destination = fixture.chain.at(-1);
  if (!destination) throw new Error("Missing destination");
  const leaf = await createChildContainer({
    parent: fixture.root,
    signer: fixture.owner,
  });
  const request = await buildContainerMoveRequest({
    destinationParent: destination.bundle,
    destinationParentKekState: destination.kekState,
    destinationParentPath: fixture.chain.map((entry) => entry.bundle),
    previous: leaf.accessManifest,
    previousContainerPath: [fixture.root.bundle, leaf.accessManifest],
    previousKekState: kekStateFromContainerResponse(leaf),
    signer: fixture.owner,
  });
  const before = await loadStructure(leaf.containerId);
  const response = await submit(
    `/containers/${leaf.containerId}/move`,
    request,
  );
  await expectPathTooDeep(response);
  await expect(loadStructure(leaf.containerId)).resolves.toEqual(before);
  await assertReadable(leaf.containerId);
}, 30_000);

test("move accounts for the entire subtree before changing depths", async () => {
  const destination = fixture.chain.at(-2);
  if (!destination) throw new Error("Missing destination");
  const parent = await createChildContainer({
    parent: fixture.root,
    signer: fixture.owner,
  });
  const child = await createChildContainer({
    parent: {
      bundle: parent.accessManifest,
      kekState: kekStateFromContainerResponse(parent),
    },
    parentPath: [fixture.root.bundle],
    signer: fixture.owner,
  });
  const request = await buildContainerMoveRequest({
    destinationParent: destination.bundle,
    destinationParentKekState: destination.kekState,
    destinationParentPath: fixture.chain
      .slice(0, -1)
      .map((entry) => entry.bundle),
    previous: parent.accessManifest,
    previousContainerPath: [fixture.root.bundle, parent.accessManifest],
    previousKekState: kekStateFromContainerResponse(parent),
    signer: fixture.owner,
  });
  const parentBefore = await loadStructure(parent.containerId);
  const childBefore = await loadStructure(child.containerId);
  const response = await submit(
    `/containers/${parent.containerId}/move`,
    request,
  );
  await expectPathTooDeep(response);
  await expect(loadStructure(parent.containerId)).resolves.toEqual(
    parentBefore,
  );
  await expect(loadStructure(child.containerId)).resolves.toEqual(childBefore);
  await assertReadable(child.containerId);
}, 30_000);

test("move permits a subtree whose deepest child reaches the readable limit", async () => {
  const destination = fixture.chain.at(-3);
  if (!destination) throw new Error("Missing destination");
  const parent = await createChildContainer({
    parent: fixture.root,
    signer: fixture.owner,
  });
  const child = await createChildContainer({
    parent: {
      bundle: parent.accessManifest,
      kekState: kekStateFromContainerResponse(parent),
    },
    parentPath: [fixture.root.bundle],
    signer: fixture.owner,
  });
  const request = await buildContainerMoveRequest({
    destinationParent: destination.bundle,
    destinationParentKekState: destination.kekState,
    destinationParentPath: fixture.chain
      .slice(0, -2)
      .map((entry) => entry.bundle),
    previous: parent.accessManifest,
    previousContainerPath: [fixture.root.bundle, parent.accessManifest],
    previousKekState: kekStateFromContainerResponse(parent),
    signer: fixture.owner,
  });
  const response = await submit(
    `/containers/${parent.containerId}/move`,
    request,
  );
  expect(response.status, (await response.clone().text()).slice(0, 200)).toBe(
    200,
  );
  await assertReadable(child.containerId);
}, 30_000);
