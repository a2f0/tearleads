import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import type {
  AttachmentDetachAccessEventBody,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
} from "@tearleads/crypto";
import { verifyAttachmentDetachEvent } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { eq, inArray } from "drizzle-orm";
import {
  bootstrapRoot,
  buildBindRequest,
  createDocumentFixture,
  registerOnly,
  runtime,
  type StoredContainerFixture,
  type StoredDocumentFixture,
  stageEncryptedBlob,
} from "../../../test/helpers/blobMutationFixtures";
import { createSignedAccessEvent } from "../../../test/helpers/keyingWriterProjectionKit";
import { createFailingRuntime } from "../../../test/helpers/serviceRuntime";
import { resolveCurrentBlobKekTargets } from "../../access/read/blobKekTargets";
import {
  BlobMutationError,
  bindBlobAttachment,
  detachBlobAttachment,
} from "./blobMutations";

async function buildDetachRequest(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly container: StoredContainerFixture;
  readonly document: StoredDocumentFixture;
  readonly owner: TestUser;
}) {
  const body: AttachmentDetachAccessEventBody = {
    eventType: "attachment.detach",
    bindingId: input.binding.bindingId,
    blobId: input.binding.blobId,
    documentId: input.binding.documentId,
    slotId: input.binding.slotId,
    documentManifestHash: input.document.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.document.bundle.manifestHash,
      input.container.bundle.manifestHash,
    ],
    objectId: input.binding.blobId,
    objectKind: "blob",
    organizationId: input.document.bundle.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const verifiedDetach = await verifyAttachmentDetachEvent({
    authorizingContainerPaths: [[input.container.bundle]],
    body: body as unknown as KeyingCanonicalJson,
    documentManifest: input.document.bundle,
    event: event.event,
    expectedBindingId: input.binding.bindingId,
    principalPolicies: input.container.principalPolicies ?? [],
    signerPublicKey: input.owner.signing.signingPublicKey,
  });
  expect(verifiedDetach.ok).toBe(true);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body,
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.container.bundle.state.containerId,
          manifestHash: input.container.bundle.manifestHash,
        },
      ],
    ],
  };
}

async function loadAttachmentBinding(bindingId: string) {
  const [row] = await db
    .select()
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, bindingId))
    .limit(1);

  return row ?? null;
}

async function loadDocumentAndContainerUpdatedAt(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<{
  readonly containerUpdatedAt: Date;
  readonly documentUpdatedAt: Date;
}> {
  const [[documentRow], [containerRow]] = await Promise.all([
    db
      .select({ updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1),
    db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, input.containerId))
      .limit(1),
  ]);
  if (!documentRow) {
    throw new Error(`Expected document sync row for ${input.documentId}`);
  }
  if (!containerRow) {
    throw new Error(`Expected container sync row for ${input.containerId}`);
  }

  return {
    containerUpdatedAt: containerRow.updatedAt,
    documentUpdatedAt: documentRow.updatedAt,
  };
}

async function setDocumentAndContainerUpdatedAt(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly updatedAt: Date;
}): Promise<void> {
  await Promise.all([
    db
      .update(documents)
      .set({ updatedAt: input.updatedAt })
      .where(eq(documents.id, input.documentId)),
    db
      .update(containers)
      .set({ updatedAt: input.updatedAt })
      .where(eq(containers.id, input.containerId)),
  ]);
}

test("attachment writes tolerate publish failures", async () => {
  const owner = createTestUser();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const failureRuntime = createFailingRuntime((event) =>
    publishedEvents.push(event),
  );
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const documentId = document.bundle.state.documentId;
  const containerId = container.bundle.state.containerId;
  const firstBlobId = crypto.randomUUID();
  const firstStage = await stageEncryptedBlob(
    {
      blobId: firstBlobId,
      owner,
    },
    failureRuntime,
  );
  const firstBind = await buildBindRequest({
    blobId: firstBlobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: firstStage,
  });
  const preBindUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await setDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
    updatedAt: preBindUpdatedAt,
  });
  const firstResponse = await bindBlobAttachment(failureRuntime, {
    blobId: firstBlobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });
  expect(firstResponse.bindingId).toBe(firstBind.verifiedBinding.bindingId);
  expect(firstResponse.writeHeaderHash).toMatch(/^[0-9a-f]{64}$/);
  const firstTargets = await resolveCurrentBlobKekTargets(firstBlobId, db);
  expect(firstResponse.blobKeyTargetHash).toBe(firstTargets.blobKeyTargetHash);
  expect(firstTargets.activeBindingIds).toEqual([
    firstBind.verifiedBinding.bindingId,
  ]);
  const afterBindTimestamps = await loadDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
  });
  expect(afterBindTimestamps.documentUpdatedAt.toISOString()).not.toBe(
    preBindUpdatedAt.toISOString(),
  );
  expect(afterBindTimestamps.containerUpdatedAt.toISOString()).toBe(
    afterBindTimestamps.documentUpdatedAt.toISOString(),
  );
  const replacementBlobId = crypto.randomUUID();
  const replacementStage = await stageEncryptedBlob({
    blobId: replacementBlobId,
    owner,
  });
  const replacementBind = await buildBindRequest({
    blobId: replacementBlobId,
    container,
    document,
    expectedBindingId: firstBind.verifiedBinding.bindingId,
    owner,
    slotId: "slot-a",
    stagedBlob: replacementStage,
  });
  const replacementResponse = await bindBlobAttachment(runtime, {
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: replacementBind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });
  expect(replacementResponse.bindingId).toBe(
    replacementBind.verifiedBinding.bindingId,
  );
  expect(
    (await loadAttachmentBinding(firstBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeInstanceOf(Date);
  expect(
    (await loadAttachmentBinding(replacementBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeNull();
  const preDetachUpdatedAt = new Date("2026-05-05T00:05:00.000Z");
  await setDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
    updatedAt: preDetachUpdatedAt,
  });
  const detachRequest = await buildDetachRequest({
    binding: replacementBind.verifiedBinding,
    container,
    document,
    owner,
  });
  Reflect.set(detachRequest, "contentKeyBundle", 0);
  const detachResponse = await detachBlobAttachment(failureRuntime, {
    bindingId: replacementBind.verifiedBinding.bindingId,
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: detachRequest,
    sessionId: "test-session",
    userId: owner.userId,
  });
  expect(detachResponse.bindingId).toBe(
    replacementBind.verifiedBinding.bindingId,
  );
  expect(
    (await loadAttachmentBinding(replacementBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeInstanceOf(Date);
  const afterDetachTimestamps = await loadDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
  });
  expect(afterDetachTimestamps.documentUpdatedAt.toISOString()).not.toBe(
    preDetachUpdatedAt.toISOString(),
  );
  expect(afterDetachTimestamps.containerUpdatedAt.toISOString()).toBe(
    afterDetachTimestamps.documentUpdatedAt.toISOString(),
  );
  expect(publishedEvents).toHaveLength(2);
  // Attach, replace, and detach register every referenced blob generation
  // under the document's organization before pruning can drop its live row.
  const registeredBlobs = await db
    .select({
      blobId: blobAuditObjects.blobId,
      organizationId: blobAuditObjects.organizationId,
    })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [firstBlobId, replacementBlobId]));
  expect(new Map(registeredBlobs.map((row) => [row.blobId, row]))).toEqual(
    new Map(
      [firstBlobId, replacementBlobId].map((blobId) => [
        blobId,
        { blobId, organizationId: document.bundle.state.organizationId },
      ]),
    ),
  );
});

test("bind rejects stale slots and targets outside its binding", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const firstDocument = await createDocumentFixture({ container, owner });
  const secondDocument = await createDocumentFixture({ container, owner });
  const blobId = crypto.randomUUID();
  const firstStage = await stageEncryptedBlob({
    blobId,
    owner,
  });
  const firstBind = await buildBindRequest({
    blobId,
    container,
    document: firstDocument,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: firstStage,
  });
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  const replacementBlobId = crypto.randomUUID();
  const staleReplacement = await buildBindRequest({
    blobId: replacementBlobId,
    container,
    document: firstDocument,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: await stageEncryptedBlob({
      blobId: replacementBlobId,
      owner,
    }),
  });
  await expect(
    bindBlobAttachment(runtime, {
      blobId: staleReplacement.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: staleReplacement.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError(
      "attachment binding previous binding id does not match expected binding id",
      409,
    ),
  );

  const unionTargetsBind = await buildBindRequest({
    activeBindings: [firstBind.verifiedBinding],
    blobId,
    container,
    document: secondDocument,
    documents: [firstDocument, secondDocument],
    expectedBindingId: null,
    owner,
    slotId: "slot-b",
  });
  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: unionTargetsBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toThrow("Blob content-key target heads are stale");

  const sharedBind = await buildBindRequest({
    blobId,
    container,
    document: secondDocument,
    expectedBindingId: null,
    owner,
    slotId: "slot-b",
  });
  const sharedResponse = await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: sharedBind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });
  const sharedTargets = await resolveCurrentBlobKekTargets(blobId, db);
  expect(sharedResponse.blobKeyTargetHash).toBe(
    sharedTargets.blobKeyTargetHash,
  );
  expect([...sharedTargets.activeBindingIds].sort()).toEqual(
    [
      firstBind.verifiedBinding.bindingId,
      sharedBind.verifiedBinding.bindingId,
    ].sort(),
  );
  expect(sharedTargets.targets).toHaveLength(2);
});
