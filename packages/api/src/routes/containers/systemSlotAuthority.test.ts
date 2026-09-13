import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("a root writer can create folders but cannot mint a system destination", async () => {
  const owner = createTestUser();
  const writer = createTestUser();
  for (const user of [owner, writer]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const share = await routeApp.request(
    `/containers/${owner.rootContainerId}/share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(
        await buildRootGrantRequest({
          previous: root.bundle,
          previousKekState: root.kekState,
          recipient: writer,
          signer: owner,
          accessLevel: "write",
        }),
      ),
    },
  );
  expect(share.status).toBe(200);
  const shared = await share.json();
  invariant(isContainerMutationResponse(shared), "expected shared root");
  const sharedRoot = {
    ...root,
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
  };
  for (const systemSlot of [null, `sys_v1_${"a".repeat(43)}`]) {
    const response = await routeApp.request("/containers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${writer.token}`,
      },
      body: JSON.stringify(
        await buildChildCreateRequest({
          root: sharedRoot,
          signer: writer,
          systemSlot,
        }),
      ),
    });
    expect(response.status).toBe(systemSlot === null ? 200 : 403);
  }
}, 15_000);

test("a read-only root recipient can verify destination roles", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  for (const user of [owner, reader]) {
    await registerUser(user);
    await authenticate(user);
  }
  const root = await bootstrapRoot(owner);
  const granted = await routeApp.request(
    `/containers/${owner.rootContainerId}/share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify(
        await buildRootGrantRequest({
          previous: root.bundle,
          previousKekState: root.kekState,
          recipient: reader,
          signer: owner,
          accessLevel: "read",
        }),
      ),
    },
  );
  expect(granted.status).toBe(200);
  const projection = await routeApp.request(
    `/containers/${owner.rootContainerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${reader.token}` } },
  );
  expect(projection.status).toBe(200);
  const body = await projection.json();
  expect(body.path.at(-1).state.parentContainerId).toBeNull();
});
