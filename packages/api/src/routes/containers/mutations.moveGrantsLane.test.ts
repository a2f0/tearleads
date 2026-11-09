import { expect } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  isOrganizationReadModelResponse,
  type OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { buildMoveRequest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { buildGrantRequest } from "../../../test/helpers/containerShareRequests";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import type { StoredContainerMutation } from "../../../test/helpers/storedContainerMutation";
import { routeApp } from "../../routeApp";

async function readModel(
  organizationId: string,
  token: string,
  cursor?: string,
): Promise<OrganizationReadModelResponse> {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body: unknown = await response.json();
  if (!isOrganizationReadModelResponse(body)) {
    throw new Error("Expected an organization read model");
  }
  return body;
}

test("a move stamps the grants lane only when it moves a listed container", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);
  const root = await bootstrapRoot(owner);
  const organizationId = String(
    Reflect.get(root.bundle.state, "organizationId"),
  );
  const child = (parent: StoredContainerMutation | null) =>
    createChild(
      parent
        ? {
            parent: accessManifestFromResponse(parent),
            parentContainerPath: [
              root.bundle,
              accessManifestFromResponse(parent),
            ],
            parentKekState: kekStateFromResponse(parent),
            signer: owner,
          }
        : {
            parent: root.bundle,
            parentKekState: root.kekState,
            signer: owner,
          },
    );
  const destination = await child(null);
  const source = await child(null);
  const grandchild = await child(source);
  const move = async (moved: StoredContainerMutation) =>
    expectMutationSuccess(
      await postMutation({
        path: `/containers/${moved.containerId}/move`,
        request: await buildMoveRequest({
          destinationParent: accessManifestFromResponse(destination),
          destinationParentKekState: kekStateFromResponse(destination),
          destinationParentPath: [
            root.bundle,
            accessManifestFromResponse(destination),
          ],
          previous: accessManifestFromResponse(moved),
          previousContainerPath: [
            root.bundle,
            accessManifestFromResponse(moved),
          ],
          previousKekState: kekStateFromResponse(moved),
          signer: owner,
        }),
        token: owner.token,
      }),
    );

  // An unlisted leaf moves without changing any listed grant row.
  const leaf = await child(null);
  const beforeLeafMove = await readModel(organizationId, owner.token);
  await move(leaf);
  const afterLeafMove = await readModel(
    organizationId,
    owner.token,
    beforeLeafMove.nextCursor,
  );
  expect(afterLeafMove.nextCursor).toBe(beforeLeafMove.nextCursor);

  // An unlisted folder whose descendant is granted rewrites that grant's
  // listed depth, so the move stamps the lane.
  const grandchildBundle = accessManifestFromResponse(grandchild);
  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${grandchild.containerId}/share`,
      request: await buildGrantRequest({
        parentKekState: kekStateFromResponse(source),
        previous: grandchildBundle,
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(source),
          grandchildBundle,
        ],
        previousKekState: kekStateFromResponse(grandchild),
        recipient,
        signer: owner,
      }),
      token: owner.token,
    }),
  );
  const beforeFolderMove = await readModel(organizationId, owner.token);
  await move(source);
  const afterFolderMove = await readModel(
    organizationId,
    owner.token,
    beforeFolderMove.nextCursor,
  );
  expect(afterFolderMove.nextCursor).not.toBe(beforeFolderMove.nextCursor);
  expect(afterFolderMove.lanes.grants).toBeDefined();
});
