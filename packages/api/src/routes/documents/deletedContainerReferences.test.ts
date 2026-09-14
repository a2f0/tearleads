import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocumentRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("document create rejects a retained manifest belonging to a deleted container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const request = await createDocumentRequest({
    owner,
    documentId: crypto.randomUUID(),
    root: {
      ...root,
      bundle: child.accessManifest,
      kekState: kekStateFromContainerResponse(child),
    },
    containerPath: [root.bundle, child.accessManifest],
  });
  const childRequest = await buildChildCreateRequest({
    signer: owner,
    parentPath: [root.bundle],
    root: {
      ...root,
      bundle: child.accessManifest,
      kekState: kekStateFromContainerResponse(child),
    },
  });
  const deleted = await routeApp.request(`/containers/${child.containerId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(deleted.status, await deleted.clone().text()).toBe(200);
  const created = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(created.status, await created.clone().text()).toBe(409);
  expect(await created.json()).toEqual({
    code: CONTAINER_UNAVAILABLE_ERROR_CODE,
    error: "targetContainerPathRefs[1] container unavailable",
  });
  const newChild = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(childRequest),
  });
  expect(newChild.status).toBe(409);
  expect(await newChild.json()).toEqual({
    code: CONTAINER_UNAVAILABLE_ERROR_CODE,
    error: "parentContainerPath[1] container unavailable",
  });
});

test("document create rejects a malformed path ID before taking UUID locks", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await createDocumentRequest({ owner, root });
  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...request,
      targetContainerPathRefs: [
        { containerId: "not-a-uuid", manifestHash: root.bundle.manifestHash },
      ],
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Document container id is invalid",
  });
});
