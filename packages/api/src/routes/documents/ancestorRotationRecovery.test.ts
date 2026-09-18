import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { signWriteHeader, type WriteHeader } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { isDocumentSyncResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("ancestor rotation keeps recovery projections and document reads available while writes fail closed", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childFixture = {
    bundle: accessManifestFromContainerResponse(child),
    kekState: kekStateFromContainerResponse(child),
    principalPolicies: root.principalPolicies,
  };
  const created = await createDocument({
    owner,
    root: childFixture,
    containerPath: [root.bundle, childFixture.bundle],
  });
  const blobId = crypto.randomUUID();
  const attachment = await buildBind({
    blobId,
    document: created,
    owner,
    root: childFixture,
    containerPath: [root.bundle, childFixture.bundle],
    stagedBlob: await stageBlob(owner),
  });
  await bindForTest({ blobId, owner, request: attachment.request });
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const postSync = (request: DocumentSyncRequest) =>
    routeApp.request(`/documents/${created.id}/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
  const createChildWrite = async () => {
    const result = await createSignedDocumentSyncRequest({
      created,
      owner,
      root: childFixture,
    });
    const path = [root, childFixture];
    result.request.authorizingContainerPathRefs = [
      path.map(({ bundle, kekState }) => ({
        containerId: kekState.containerId,
        manifestHash: bundle.manifestHash,
      })),
    ];
    for (const update of result.request.outgoingUpdates) {
      const { signature: _signature, ...header } =
        update.writeHeader as unknown as WriteHeader;
      update.writeHeader = {
        ...(await signWriteHeader(
          {
            ...header,
            dependencyManifestHashes: path
              .map(({ bundle }) => bundle.manifestHash)
              .sort(),
          },
          owner.signing.signingPrivateKey,
        )),
      };
    }
    return result;
  };
  const initialWrite = await createChildWrite();
  const initialResponse = await postSync(initialWrite.request);
  expect(await initialResponse.clone().json()).not.toHaveProperty("error");
  expect(initialResponse.status).toBe(200);
  const pendingWrite = await createChildWrite();
  const rotation = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const rotated = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    { method: "POST", headers, body: JSON.stringify(rotation.request) },
  );
  expect(rotated.status).toBe(200);

  for (const path of [
    `/containers/${child.containerId}/writer-projection`,
    `/documents/${created.id}/writer-projection`,
  ]) {
    expect((await routeApp.request(path, { headers })).status).toBe(200);
  }
  const attachments = await routeApp.request(
    `/documents/${created.id}/attachments`,
    { headers },
  );
  expect(attachments.status).toBe(200);
  expect(await attachments.json()).toMatchObject([
    {
      bindingId: attachment.binding.bindingId,
      blobId,
      contentKeyBundle: attachment.request.contentKeyBundle,
      blobKekTargets: {
        targets: [
          {
            containerId: child.containerId,
            containerKeyEpochId: child.containerKek.containerKeyEpochId,
          },
        ],
      },
    },
  ]);
  const read = await postSync({
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  });
  expect(read.status).toBe(200);
  const body = await read.json();
  expect(isDocumentSyncResponse(body)).toBe(true);
  if (!isDocumentSyncResponse(body)) throw new Error("Expected sync response");
  expect(body.updates.map(({ id }) => id)).toContain(initialWrite.updateId);

  const write = await postSync(pendingWrite.request);
  expect(write.status).toBe(409);
  expect(await write.json()).toMatchObject({
    error: expect.stringContaining("parent edge is stale"),
  });
});
