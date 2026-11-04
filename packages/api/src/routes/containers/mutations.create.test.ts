import { test as bunTest, expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  buildCreateRequest,
  buildMetadataDocumentCreateRequest,
} from "../../../test/helpers/containerCreateRequests";
import {
  createTestContainerKekId,
  createTestContainerKekPredecessorBridge,
} from "../../../test/helpers/containerKekMaterial";
import { asVerifiedContainerManifest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  expectMutationSuccess,
  postJson,
  postMutation,
  registerAndAuthenticate,
  TEST_CONTACTS_SYSTEM_SLOT,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { currentDocumentLinkRows } from "../../../test/helpers/currentDocumentLinks";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";

test("POST /containers materializes the signed metadata document binding", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const created = await expectMutationSuccess(
    await postMutation({
      path: "/containers",
      request,
      token: owner.token,
    }),
  );
  const createdManifest = accessManifestFromResponse(created);
  const metadataDocumentId =
    asVerifiedContainerManifest(createdManifest).state.metadataDocumentId;
  const [binding] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, created.containerId))
    .limit(1);

  expect(binding).toEqual({
    containerId: created.containerId,
    documentId: metadataDocumentId,
  });
});

test("POST /containers rejects a predecessor bridge on its initial KEK epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const initialKeyEpochId = String(Reflect.get(request.keyEpoch, "id"));
  request.predecessorBridge = (await createTestContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKeyEpochId: initialKeyEpochId,
    successorContainerKeyEpochId: await createTestContainerKekId(
      containerId,
      2,
    ),
  })) as unknown as Record<string, unknown>;

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Initial container KEK epoch cannot have rotation artifacts",
  });
});

bunTest.each([null, TEST_CONTACTS_SYSTEM_SLOT])(
  "POST /containers/with-metadata-document atomically creates slot %s",
  async (systemSlot) => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const containerId = crypto.randomUUID();
    const containerRequest = await buildCreateRequest({
      systemSlot,
      containerId,
      parent: root.bundle,
      parentKekState: root.kekState,
      signer: owner,
    });
    const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
      containerId,
      containerRequest,
      parent: root.bundle,
      signer: owner,
    });

    const response = await postJson({
      path: "/containers/with-metadata-document",
      request: {
        ...(systemSlot ? { systemSlot } : {}),
        container: containerRequest,
        metadataDocument: metadataDocumentRequest,
      },
      token: owner.token,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(isContainerCreateWithMetadataDocumentResponse(body)).toBe(true);
    if (!isContainerCreateWithMetadataDocumentResponse(body)) {
      throw new Error("expected composite container metadata response");
    }
    expect(body.container.containerId).toBe(containerId);
    expect(body.container.systemSlot).toBe(systemSlot ?? undefined);
    expect(body.metadataDocument.id).toBe(
      (containerRequest.body as { readonly metadataDocumentId: string })
        .metadataDocumentId,
    );

    const [metadataBinding] = await db
      .select({
        containerId: containerMetadataDocuments.containerId,
        documentId: containerMetadataDocuments.documentId,
      })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.containerId, containerId))
      .limit(1);
    expect(metadataBinding).toEqual({
      containerId,
      documentId: body.metadataDocument.id,
    });
    const [containerRow] = await db
      .select({
        systemSlot: containers.systemSlot,
        parentId: containers.parentId,
      })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1);
    expect(containerRow).toEqual({
      systemSlot,
      parentId: owner.rootContainerId,
    });

    const [documentLink] = await currentDocumentLinkRows(
      body.metadataDocument.id,
    );
    expect(documentLink).toEqual({
      containerId,
    });
  },
  10_000,
);

test("POST /containers rejects metadata document id reuse", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentId = (
    request.body as { readonly metadataDocumentId: string }
  ).metadataDocumentId;
  await db.insert(documents).values({
    id: metadataDocumentId,
    createdByFingerprint: owner.fingerprint,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Container metadata document already exists",
  });
});

test("POST /containers rejects child creates under stale parent manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    parentManifestHashOverride: "0".repeat(64),
    signer: owner,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
});

test("POST /containers rejects signed events with missing dependency manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    dependencyManifestHashesOverride: [],
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Access event dependency hashes do not match supplied manifests",
  });
});

test("POST /containers rejects malformed KEK request records", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  request.keyEpoch = {
    ...request.keyEpoch,
    keyEpoch: "1",
  };

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "keyEpoch.keyEpoch is invalid",
  });
});
