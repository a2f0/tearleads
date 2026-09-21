import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../test/helpers/containerGrantMutation";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocumentRequest,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import {
  getCurrentContainerKeyEpoch,
  getCurrentContainerKeyEpochPins,
} from "../access/read/containerKekStore";
import { routeApp } from "../routeApp";

test("document create applies a chained container rekey batch", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });
  const request = await createDocumentRequest({
    owner,
    root: {
      bundle: secondRekey.bundle,
      kekState: secondRekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  request.containerRekeys = [firstRekey.request, secondRekey.request];

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  expect(isDocumentCreateResponse(await response.json())).toBe(true);
  const currentEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentEpoch?.id).toBe(secondRekey.kekState.containerKeyEpochId);
  // The batched reader picks each container's latest epoch, not every epoch:
  // this root now has three, and an unknown container simply has no entry.
  const unknownId = crypto.randomUUID();
  const pins = await getCurrentContainerKeyEpochPins(
    [root.kekState.containerId, root.kekState.containerId, unknownId],
    db,
  );
  expect([...pins.keys()]).toEqual([root.kekState.containerId]);
  expect(pins.get(root.kekState.containerId)).toEqual({
    id: secondRekey.kekState.containerKeyEpochId,
    parentContainerKeyEpochId: null,
  });
});

// #2340 finding 1. An inline rekey is a rotation like any other: one that would
// leave a level above a directly granted container pinned to a retired epoch is
// refused, and takes the write down with it. The SDK never signs such a batch
// on its own, but a client is free to rekey a current container inline.

test("an inline rekey that strands a granted path refuses the whole write", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const grantee = createTestUser();
  await registerUser(grantee);
  await authenticate(grantee);
  const root = await bootstrapRoot(owner);
  const upper = await createChildContainer({ parent: root, signer: owner });
  const upperBundle = accessManifestFromContainerResponse(upper);
  const upperKek = kekStateFromContainerResponse(upper);
  const lower = await createChildContainer({
    parent: { bundle: upperBundle, kekState: upperKek },
    parentPath: [root.bundle],
    signer: owner,
  });
  const lowerBundle = accessManifestFromContainerResponse(lower);
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const granted = await routeApp.request(
    `/containers/${lower.containerId}/share`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        await buildContainerGrantRequest({
          parentKekState: upperKek,
          previous: lowerBundle,
          previousContainerPath: [root.bundle, upperBundle, lowerBundle],
          previousKekState: kekStateFromContainerResponse(lower),
          recipient: grantee,
          signer: owner,
        }),
      ),
    },
  );
  expect(granted.status, (await granted.clone().text()).slice(0, 300)).toBe(
    200,
  );

  // Rotating the root inline strands `upper`, which sits above the grant.
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const request = await createDocumentRequest({
    owner,
    root: {
      bundle: rekey.bundle,
      kekState: rekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  request.containerRekeys = [rekey.request];
  const response = await routeApp.request("/documents", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_descendant_rekeys_required",
  });
  // The rekey rolled back with the write it rode in on.
  const currentEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});
