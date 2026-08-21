import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isDocumentCreateResponse } from "@symcrypt/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { getCurrentContainerKeyEpoch } from "../access/read/containerKekStore";
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
});
