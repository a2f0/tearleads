import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createFirstUpdateSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { planAttachmentDocumentHeadLockRuns } from "../../workflows/blobs/mutations/authorizationLocks";
import { lockSyncDocumentWriteFrontier } from "../../workflows/documents/mutations/syncWriteFrontier";
import { BlobMutationError, bindBlobAttachment } from "./blobMutations";

async function documentWithRoot(): Promise<{
  readonly document: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  return { document: await createDocument({ owner, root }), owner, root };
}

async function stagedBindWithSync(input: {
  readonly document: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}) {
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document: input.document,
    owner: input.owner,
    root: input.root,
    stagedBlob: await stageBlob(input.owner, blobId),
  });
  const sync = await createFirstUpdateSyncRequest(input);
  return {
    blobId,
    request: { ...request, documentSync: sync.request },
    updateId: sync.id,
  };
}

function bind(
  owner: TestUser,
  blobId: string,
  request: BlobAttachmentBindRequest,
) {
  return bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request,
    sessionId: "bind-document-sync-test",
    userId: owner.userId,
  });
}

async function storedState(documentId: string) {
  const [bindings, updates] = await Promise.all([
    db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
  ]);
  return {
    bindingBlobIds: bindings.map((row) => row.blobId),
    updateIds: updates.map((row) => row.id),
  };
}

test("a bind commits the document sync it carries after its binding", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request, updateId } = await stagedBindWithSync(fixture);

  const response = await bind(fixture.owner, blobId, request);

  expect(response.documentSync).toMatchObject({
    acceptedOutgoingUpdateIds: [updateId],
    commitLsnMode: expect.any(String),
  });
  expect(await storedState(fixture.document.id)).toEqual({
    bindingBlobIds: [blobId],
    updateIds: [updateId],
  });
}, 20_000);

test("a bind without a document sync reports none", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBindWithSync(fixture);
  const { documentSync: _omitted, ...plain } = request;

  const response = await bind(fixture.owner, blobId, plain);

  expect(response.documentSync).toBeUndefined();
  expect(await storedState(fixture.document.id)).toEqual({
    bindingBlobIds: [blobId],
    updateIds: [],
  });
}, 20_000);

test("a document sync the sync route would refuse fails the whole bind", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBindWithSync(fixture);
  const stale = {
    ...request,
    documentSync: {
      ...(request.documentSync as DocumentSyncRequest),
      expectedTargetHash: "0".repeat(64),
    },
  };

  const failure = await bind(fixture.owner, blobId, stale).catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(BlobMutationError);
  expect((failure as BlobMutationError).status).toBe(409);
  // The binding rolls back with the refused update; the client then binds
  // without it and ships the update alone.
  expect(await storedState(fixture.document.id)).toEqual({
    bindingBlobIds: [],
    updateIds: [],
  });
  const retried = await bind(fixture.owner, blobId, {
    ...request,
    documentSync: undefined,
  });
  expect(retried.documentSync).toBeUndefined();
}, 20_000);

test("a document sync naming a malformed container id is a 400", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBindWithSync(fixture);
  const sync = request.documentSync as DocumentSyncRequest;

  const failure = await bind(fixture.owner, blobId, {
    ...request,
    documentSync: {
      ...sync,
      authorizingContainerPathRefs: [
        [{ containerId: "not-a-uuid", manifestHash: "0".repeat(64) }],
      ],
    },
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(BlobMutationError);
  expect((failure as BlobMutationError).status).toBe(400);
}, 20_000);

test("a bind locks its own document head FOR UPDATE in sorted position", () => {
  expect(planAttachmentDocumentHeadLockRuns(["c", "a", "b"], "b")).toEqual([
    { mode: "share", objectIds: ["a"] },
    { mode: "update", objectIds: ["b"] },
    { mode: "share", objectIds: ["c"] },
  ]);
  expect(planAttachmentDocumentHeadLockRuns(["b", "a"], undefined)).toEqual([
    { mode: "share", objectIds: ["a", "b"] },
  ]);
});

test("a carried sync refuses a head its carrying transaction did not lock", async () => {
  const fixture = await documentWithRoot();
  const failure = await db
    .transaction((tx) =>
      lockSyncDocumentWriteFrontier({
        authorizingContainerIds: [],
        documentId: fixture.document.id,
        frontier: {
          linkSetManifestHash: fixture.document.accessManifest.manifestHash,
          linkedContainerIds: [fixture.root.kekState.containerId],
        },
        requireHeldHeads: true,
        tx,
      }),
    )
    .catch((error: unknown) => error);

  expect(failure).toMatchObject({ status: 409 });
}, 20_000);

test("the bind route admits only a single-update document sync", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBindWithSync(fixture);
  const sync = request.documentSync as DocumentSyncRequest;
  const [update] = sync.outgoingUpdates;
  if (!update) throw new Error("Expected one update");

  const response = await routeApp.request(
    `/blobs/${blobId}/attachment-bindings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        documentSync: {
          ...sync,
          outgoingUpdates: [update, { ...update, id: crypto.randomUUID() }],
        },
      }),
    },
  );

  expect(response.status).toBe(400);
}, 20_000);
