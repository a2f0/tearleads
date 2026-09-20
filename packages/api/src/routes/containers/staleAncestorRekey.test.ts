import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRekeyRequest } from "../../../test/helpers/containerMutationRotations";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("leaf rotation requires its intermediate ancestor to be repaired first", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childFixture = {
    bundle: accessManifestFromContainerResponse(child),
    kekState: kekStateFromContainerResponse(child),
  };
  const leaf = await createChildContainer({
    parent: childFixture,
    parentPath: [root.bundle],
    signer: owner,
  });
  const leafBundle = accessManifestFromContainerResponse(leaf);
  const rotatedRoot = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const postRekey = (id: string, request: ContainerMutationRequest) =>
    routeApp.request(`/containers/${id}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  expect(
    (await postRekey(root.kekState.containerId, rotatedRoot.request)).status,
  ).toBe(200);
  const staleLeafRequest = await buildRekeyRequest({
    parentKekState: childFixture.kekState,
    previous: leafBundle,
    previousContainerPath: [
      rotatedRoot.bundle,
      childFixture.bundle,
      leafBundle,
    ],
    previousKekState: kekStateFromContainerResponse(leaf),
    signer: owner,
  });
  const rejected = await postRekey(leaf.containerId, staleLeafRequest);
  const rejection = await rejected.json();
  expect(rejected.status, JSON.stringify(rejection)).toBe(409);
  expect(rejection).toMatchObject({
    code: "container_mutation_state_stale",
  });
  const repairedChild = await postRekey(
    child.containerId,
    await buildRekeyRequest({
      parentKekState: rotatedRoot.kekState,
      previous: childFixture.bundle,
      previousContainerPath: [rotatedRoot.bundle, childFixture.bundle],
      previousKekState: childFixture.kekState,
      signer: owner,
    }),
  );
  const repaired = await repairedChild.json();
  expect(repairedChild.status, JSON.stringify(repaired)).toBe(200);
  if (!isContainerMutationResponse(repaired)) {
    throw new Error("Expected repaired child response");
  }
  const repairedLeaf = await postRekey(
    leaf.containerId,
    await buildRekeyRequest({
      parentKekState: kekStateFromContainerResponse(repaired),
      previous: leafBundle,
      previousContainerPath: [
        rotatedRoot.bundle,
        accessManifestFromContainerResponse(repaired),
        leafBundle,
      ],
      previousKekState: kekStateFromContainerResponse(leaf),
      signer: owner,
    }),
  );
  expect(repairedLeaf.status, await repairedLeaf.text()).toBe(200);
});
