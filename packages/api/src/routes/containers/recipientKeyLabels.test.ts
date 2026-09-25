import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("a writer cannot relabel user KEK recipients and poison the shared head", async () => {
  const owner = createTestUser();
  const writer = createTestUser();
  for (const user of [owner, writer]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const post = (token: string, action: string, body: unknown) =>
    routeApp.request(`/containers/${root.kekState.containerId}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const sharedResponse = await post(
    owner.token,
    "share",
    await buildRootGrantRequest({
      accessLevel: "write",
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: writer,
      signer: owner,
    }),
  );
  expect(sharedResponse.status).toBe(200);
  const shared: unknown = await sharedResponse.json();
  if (!isContainerMutationResponse(shared)) throw new Error("Missing share");
  const rekey = await buildRootContainerRekeyMutation({
    previous: {
      bundle: accessManifestFromContainerResponse(shared),
      kekState: kekStateFromContainerResponse(shared),
      principalPolicies: root.principalPolicies,
    },
    signer: writer,
  });
  const relabeled = {
    ...rekey.request,
    userRecipientKeys: rekey.request.userRecipientKeys?.map((key) => ({
      ...key,
      recipientKeyEpochId: `${Reflect.get(key, "recipientKeyEpochId")}:relabelled`,
    })),
    wraps: rekey.request.wraps.map((wrap) =>
      Reflect.get(wrap, "recipientKind") === "user"
        ? {
            ...wrap,
            recipientKeyEpochId: `${Reflect.get(wrap, "recipientKeyEpochId")}:relabelled`,
          }
        : wrap,
    ),
  };
  expect(relabeled.userRecipientKeys).toHaveLength(1);
  const refused = await post(writer.token, "rekey", relabeled);
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain("recipient key epoch");

  // The rejected transaction did not advance the head: the original signed
  // request still commits, and the owner can read the resulting projection.
  expect((await post(writer.token, "rekey", rekey.request)).status).toBe(200);
  const projection = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(projection.status).toBe(200);
});
