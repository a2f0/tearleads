import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { computeBlobContentKeyTargetHash } from "@tearleads/crypto";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { buildContainerGrantRequest } from "../../../../test/helpers/containerGrantMutation";
import { buildChildCreateRequest } from "../../../../test/helpers/containerMutationArtifactKit";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";

test("writing a destination does not authorize rebinding a private existing blob", async () => {
  const owner = createTestUser();
  const writer = createTestUser();
  for (const user of [owner, writer]) {
    await registerUser(user);
    await authenticate(user);
  }
  let root = await bootstrapRoot(owner);
  const created = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await buildChildCreateRequest({ root, signer: owner }),
    ),
  });
  expect(created.status).toBe(200);
  const child = await created.json();
  invariant(
    isContainerMutationResponse(child),
    "expected destination container",
  );
  const granted = await routeApp.request(
    `/containers/${child.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildContainerGrantRequest({
          previous: accessManifestFromContainerResponse(child),
          previousKekState: kekStateFromContainerResponse(child),
          previousContainerPath: [
            root.bundle,
            accessManifestFromContainerResponse(child),
          ],
          parentKekState: root.kekState,
          recipient: writer,
          signer: owner,
          accessLevel: "write",
        }),
      ),
    },
  );
  expect(granted.status).toBe(200);
  const shared = await granted.json();
  invariant(isContainerMutationResponse(shared), "expected shared destination");
  root = await bootstrapRoot(owner);
  const victim = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const original = await buildBind({
    blobId,
    document: victim,
    owner,
    root,
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request: original.request });
  const destination = {
    ...root,
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
  };
  const containerPath = [root.bundle, destination.bundle];
  const target = await createDocument({
    owner: writer,
    root: destination,
    containerPath,
  });
  const attempted = await buildBind({
    blobId,
    document: target,
    owner: writer,
    root: destination,
    containerPath,
    contentKeyEpoch: 1,
  });
  // Knowing the retained blob id and public target fields is not source authority.
  const targets = [
    ...original.request.contentKeyBundle.targets,
    ...attempted.request.contentKeyBundle.targets,
  ];
  attempted.request.contentKeyBundle = {
    ...attempted.request.contentKeyBundle,
    targets,
    targetHash: await computeBlobContentKeyTargetHash(
      targets.map(
        ({ wrappedKey: _wrapped, wrappingMetadata: _metadata, ...target }) =>
          target,
      ),
    ),
  };
  await expect(
    bindForTest({ blobId, owner: writer, request: attempted.request }),
  ).rejects.toMatchObject({ status: 403 });
});
