import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "@tearleads/validators/response";
import { createMiddleware } from "hono/factory";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { createChildContainer } from "../../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import type { SessionEnv } from "../../../middleware/session";
import { createRouteApp, routeApp } from "../../../routeApp";
import { BlobMutationError } from "./types";

// #2278 M9: attachment binds resolve their authorizing paths through the same
// live-row check as document create/link-set, so a path citing a retained
// manifest of a deleted container is refused before it can authorize anything.
// The valid root path keeps the request well-formed up to that check; the
// second group cites the child that is deleted after the request is signed.
// The refusal keeps the shared `container_unavailable` code all the way to
// the route body (#4), so a client can tell it from a transient 409.
test("attachment bind rejects an authorizing path through a deleted container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const built = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner),
  });
  const request = {
    ...built.request,
    authorizingContainerPathRefs: [
      ...built.request.authorizingContainerPathRefs,
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: root.bundle.manifestHash,
        },
        {
          containerId: child.containerId,
          manifestHash: child.accessManifest.manifestHash,
        },
      ],
    ],
  };

  const deleted = await routeApp.request(`/containers/${child.containerId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(deleted.status, await deleted.clone().text()).toBe(200);

  const bind = bindForTest({ blobId, owner, request });
  await expect(bind).rejects.toBeInstanceOf(BlobMutationError);
  await expect(bind).rejects.toMatchObject({
    code: CONTAINER_UNAVAILABLE_ERROR_CODE,
    message: "authorizingContainerPathRefs[1][1] container unavailable",
    status: 409,
  });

  // The route renders the code, not just the diagnostic. The route mounts on
  // the kit's runtime so the staged bytes are visible to the service check.
  const app = createRouteApp({
    requireAuth: createMiddleware<SessionEnv>(async (c, next) => {
      c.set("session", {
        createdAt: Date.now(),
        fingerprint: owner.fingerprint,
        id: "deleted-container-path-session",
        ipAddresses: [],
        lastActiveAt: Date.now(),
        lastActiveIp: null,
        userId: owner.userId,
      });
      return next();
    }),
    runtime: blobAttachmentTestRuntime,
  });
  const response = await app.request(`/blobs/${blobId}/attachment-bindings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toEqual({
    code: CONTAINER_UNAVAILABLE_ERROR_CODE,
    error: "authorizingContainerPathRefs[1][1] container unavailable",
  });
});
