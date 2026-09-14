import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { computeBlobContentKeyTargetHash } from "@tearleads/crypto";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
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
  type StoredRootFixture,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { getLatestBlobContentKeyBundle } from "../../../access/read/blobContentKeyStore";
import { routeApp } from "../../../routeApp";

type TestUser = ReturnType<typeof createTestUser>;

async function postJson(user: TestUser, path: string, body: unknown) {
  const response = await routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const json = await response.json();
  invariant(isContainerMutationResponse(json), "expected container response");
  return json;
}

/** A child of `root` shared with `recipient` at `accessLevel`. */
async function createSharedChild(input: {
  accessLevel: "read" | "write";
  owner: TestUser;
  recipient: TestUser;
  root: StoredRootFixture;
}): Promise<ContainerMutationResponse> {
  const { owner, root } = input;
  const child = await postJson(
    owner,
    "/containers",
    await buildChildCreateRequest({ root, signer: owner }),
  );
  return postJson(
    owner,
    `/containers/${child.containerId}/share`,
    await buildContainerGrantRequest({
      accessLevel: input.accessLevel,
      parentKekState: root.kekState,
      previous: accessManifestFromContainerResponse(child),
      previousContainerPath: [
        root.bundle,
        accessManifestFromContainerResponse(child),
      ],
      previousKekState: kekStateFromContainerResponse(child),
      recipient: input.recipient,
      signer: owner,
    }),
  );
}

function asDestination(
  root: StoredRootFixture,
  shared: ContainerMutationResponse,
) {
  return {
    ...root,
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
  };
}

// The positive half of `assertExistingBlobSourceAuthority`: a non-author with
// current read on a document actively binding the blob holds source authority
// for those bytes, so it may bind them to a document it can write.
test("current read on an actively bound document authorizes rebinding the blob", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  for (const user of [owner, reader]) {
    await registerUser(user);
    await authenticate(user);
  }
  let root = await bootstrapRoot(owner);
  const readable = await createSharedChild({
    accessLevel: "read",
    owner,
    recipient: reader,
    root,
  });
  const writable = await createSharedChild({
    accessLevel: "write",
    owner,
    recipient: reader,
    root,
  });
  root = await bootstrapRoot(owner);
  const source = asDestination(root, readable);
  const sourcePath = [root.bundle, source.bundle];
  const bound = await createDocument({
    owner,
    root: source,
    containerPath: sourcePath,
  });
  const blobId = crypto.randomUUID();
  const original = await buildBind({
    blobId,
    containerPath: sourcePath,
    document: bound,
    owner,
    root: source,
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request: original.request });

  const destination = asDestination(root, writable);
  const destinationPath = [root.bundle, destination.bundle];
  const target = await createDocument({
    containerPath: destinationPath,
    owner: reader,
    root: destination,
  });
  const rebind = await buildBind({
    blobId,
    containerPath: destinationPath,
    contentKeyEpoch: 1,
    document: target,
    owner: reader,
    root: destination,
  });
  // The blob's content-key bundle must keep covering the source document.
  const targets = [
    ...original.request.contentKeyBundle.targets,
    ...rebind.request.contentKeyBundle.targets,
  ];
  rebind.request.contentKeyBundle = {
    ...rebind.request.contentKeyBundle,
    targets,
    targetHash: await computeBlobContentKeyTargetHash(
      targets.map(
        ({ wrappedKey: _wrapped, wrappingMetadata: _metadata, ...target }) =>
          target,
      ),
    ),
  };
  await bindForTest({ blobId, owner: reader, request: rebind.request });

  const bundle = await getLatestBlobContentKeyBundle(blobId, db);
  expect(
    new Set(bundle?.targets.map((target) => target.documentId) ?? []),
  ).toEqual(new Set([bound.id, target.id]));
});
