import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("a deleted container's metadata document ID cannot start a new document history", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const documentId = asVerifiedContainerManifest(child.accessManifest).state
    .metadataDocumentId;
  const postDocument = (request: unknown) =>
    routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const created = await postDocument(
    await createDocumentRequest({
      owner,
      documentId,
      root: {
        ...root,
        bundle: child.accessManifest,
        kekState: await kekStateFromContainerResponse(child),
      },
      containerPath: [root.bundle, child.accessManifest],
    }),
  );
  expect(created.status).toBe(200);
  const deleted = await routeApp.request(`/containers/${child.containerId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(deleted.status).toBe(200);
  const recreated = await postDocument(
    await createDocumentRequest({ owner, documentId, root }),
  );
  expect(recreated.status).toBe(409);
  expect(await recreated.json()).toEqual({
    error: "Document ID belongs to a deleted container",
  });
  const newContainer = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await buildChildCreateRequest({
        root,
        signer: owner,
        metadataDocumentId: documentId,
      }),
    ),
  });
  expect(newContainer.status).toBe(409);
  expect(await newContainer.json()).toEqual({
    error: "Container metadata document already exists",
  });
});

test("a purged document ID cannot become a new container's metadata document", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const purged = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
  });
  expect(purged.status, await purged.clone().text()).toBe(200);

  const newContainer = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await buildChildCreateRequest({
        root,
        signer: owner,
        metadataDocumentId: created.id,
      }),
    ),
  });
  expect(newContainer.status).toBe(409);
  expect(await newContainer.json()).toEqual({
    error: "Container metadata document was permanently purged",
  });
});
