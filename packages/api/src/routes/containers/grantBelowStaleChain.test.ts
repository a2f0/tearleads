import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const post = (token: string, path: string, request: ContainerMutationRequest) =>
  routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

// #2340 finding 1. With nothing shared beneath it, a chain may sit lazily stale
// after an ancestor rotation. The first grant below it would hand a grantee a
// path it can never make current: it re-keys from its own container downward,
// never the levels above. So that grant is refused until the chain is repaired.
// `inaccessibleIntermediateRepair.test.ts` covers the SDK repairing it first.

test("a first grant is refused below a stale chain", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

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

  // Nothing below the root is granted, so it may rotate alone.
  const rotation = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const rotated = await post(
    owner.token,
    `/containers/${root.kekState.containerId}/rekey`,
    rotation.request,
  );
  expect(rotated.status, (await rotated.clone().text()).slice(0, 300)).toBe(
    200,
  );

  // `upper` now pins a retired root epoch, so a first grant on `lower` would
  // strand its grantee behind a level only the owner can re-key.
  const stranded = await post(
    owner.token,
    `/containers/${lower.containerId}/share`,
    await buildContainerGrantRequest({
      parentKekState: upperKek,
      previous: lowerBundle,
      previousContainerPath: [rotation.bundle, upperBundle, lowerBundle],
      previousKekState: kekStateFromContainerResponse(lower),
      recipient,
      signer: owner,
    }),
  );
  expect(stranded.status).toBe(409);
  expect(await stranded.json()).toMatchObject({
    code: "container_mutation_state_stale",
    error: expect.stringContaining("parent edge is stale"),
  });
}, 120_000);
