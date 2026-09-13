import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { createChildContainer } from "../../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";
import { BlobMutationError } from "./types";

// #2278 M9: attachment binds resolve their authorizing paths through the same
// live-row check as document create/link-set, so a path citing a retained
// manifest of a deleted container is refused before it can authorize anything.
// The valid root path keeps the request well-formed up to that check; the
// second group cites the child that is deleted after the request is signed.
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
    message: "authorizingContainerPathRefs[1][1] container unavailable",
    status: 409,
  });
});
