import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  createFirstUpdateSyncRequest,
  createSignedDocumentSyncRequest,
} from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  commitLsnEvents,
  traceSyncQueries,
  updateUpperBoundIndex,
} from "../../../test/helpers/syncQueryTrace";
import { getDocumentContentKeyBundle } from "../../access/read/documentContentKeyStore";
import { readCurrentCommitLsn } from "../../documents/commitLsn";
import {
  listMissingDocumentUpdatePage,
  listMissingDocumentUpdates,
} from "../../documents/documentUpdateStore";
import { createRouteApp } from "../../routeApp";
import { bindBlobAttachment } from "../../services/blobs/blobMutations";
import { getDefaultApiServiceRuntime } from "../../services/runtime";
import { listMissingSyncUpdatesForResponse } from "../../workflows/documents/mutations/syncPullResponse";

const unreachableMinLsn = "FFFFFFFF/FFFFFFFF";
const minLsnError = "Requested minimum commit LSN has not been reached";

async function registeredRoot() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  return { owner, root: await bootstrapRoot(owner) };
}

async function fixture() {
  const input = await registeredRoot();
  const document = await createDocument(input);
  const sync = await createSignedDocumentSyncRequest({
    ...input,
    created: document,
  });
  return { ...input, document, ...sync };
}

async function storedUpdates(documentId: string) {
  return db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
}

function post(token: string, path: string, body: unknown) {
  return traceSyncQueries(db, async (database) => {
    const app = createRouteApp({
      runtime: { ...getDefaultApiServiceRuntime(), db: database },
    });
    return app.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  });
}

test("an unsatisfied minLsn rolls back sync writes before the snapshot", async () => {
  const { owner, document, request, updateId } = await fixture();
  const { events, result } = await post(
    owner.token,
    `/documents/${document.id}/sync`,
    {
      ...request,
      minLsn: unreachableMinLsn,
    },
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: minLsnError });
  expect(commitLsnEvents(events).map(({ scope }) => scope)).toEqual([
    "transaction",
  ]);
  expect(updateUpperBoundIndex(events)).toBe(-1);
  expect(events).toContainEqual({ kind: "rolledBack" });
  expect(events).not.toContainEqual({ kind: "committed" });
  expect(
    events.some(
      (event) =>
        event.kind === "query" &&
        event.sql.includes('insert into "document_updates"'),
    ),
  ).toBe(true);
  expect(await storedUpdates(document.id)).toEqual([]);
  const retry = await post(owner.token, `/documents/${document.id}/sync`, {
    ...request,
    minLsn: await readCurrentCommitLsn(db),
  });
  expect(retry.result.status).toBe(200);
  expect(await storedUpdates(document.id)).toEqual([{ id: updateId }]);
});

test("an unsatisfied minLsn precedes cursor authentication on a read-only continuation", async () => {
  const { owner, document, request } = await fixture();
  const continuation = {
    ...request,
    authorizingContainerPathRefs: undefined,
    outgoingUpdates: [],
    pullCursor: "invalid-cursor",
  };
  const { events, result } = await post(
    owner.token,
    `/documents/${document.id}/sync`,
    {
      ...continuation,
      minLsn: unreachableMinLsn,
    },
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: minLsnError });
  expect(updateUpperBoundIndex(events)).toBe(-1);
  const reachedCursor = await post(
    owner.token,
    `/documents/${document.id}/sync`,
    {
      ...continuation,
      minLsn: await readCurrentCommitLsn(db),
    },
  );
  expect(reachedCursor.result.status).toBe(409);
  expect(await reachedCursor.result.json()).toEqual({
    code: "document_sync_state_stale",
    error: "Document pull cursor is invalid; restart the pull",
  });
});

test("stale sync state still takes precedence over an unsatisfied minLsn", async () => {
  const { owner, document, request } = await fixture();
  const { events, result } = await post(
    owner.token,
    `/documents/${document.id}/sync`,
    {
      ...request,
      minLsn: unreachableMinLsn,
      expectedTargetHash: "0".repeat(64),
    },
  );
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({
    code: "document_sync_state_stale",
  });
  expect(commitLsnEvents(events)).toEqual([]);
  expect(await storedUpdates(document.id)).toEqual([]);
});

test("direct page, unpaged and unpaged response readers retain their minimum-LSN guard", async () => {
  const { document, request } = await fixture();
  const contentKeyBundle = await getDocumentContentKeyBundle(
    document.id,
    document.contentKeyEpoch,
    db,
  );
  if (!contentKeyBundle) throw new Error("Expected stored content-key bundle");
  const input = {
    documentId: document.id,
    localVersionVector: null,
    minLsn: unreachableMinLsn,
  };
  const readers = [
    () =>
      listMissingDocumentUpdatePage(db, {
        ...input,
        afterSequence: 0,
        upperBoundSequence: 0,
        maxUpdates: 64,
        maxSerializedBytes: 100_000,
      }),
    () => listMissingDocumentUpdates(db, input),
    () =>
      listMissingSyncUpdatesForResponse({
        contentKeyBundle,
        documentId: document.id,
        executor: db,
        pullPagePlan: null,
        request: { ...request, minLsn: unreachableMinLsn },
      }),
  ];
  for (const read of readers) {
    const { events, result } = await traceSyncQueries(db, () =>
      read().catch((error: unknown) => error),
    );
    expect(result).toMatchObject({ status: 503, message: minLsnError });
    expect(commitLsnEvents(events).map(({ scope }) => scope)).toEqual(["root"]);
  }
});

test("an unsatisfied create seed minLsn rolls back both document and update", async () => {
  const input = await registeredRoot();
  const create = await createDocumentRequest(input);
  const document = {
    accessManifest: { state: create.manifest },
    contentKeyBundle: create.contentKeyBundle,
    id: String(Reflect.get(create.manifest, "objectId")),
  } as unknown as CreatedDocumentFixture;
  const sync = await createFirstUpdateSyncRequest({ ...input, document });
  const { events, result } = await post(input.owner.token, "/documents", {
    ...create,
    initialSync: { ...sync.request, minLsn: unreachableMinLsn },
  });
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: minLsnError });
  expect(commitLsnEvents(events).map(({ scope }) => scope)).toEqual([
    "transaction",
  ]);
  expect(events).toContainEqual({ kind: "rolledBack" });
  expect(await storedUpdates(document.id)).toEqual([]);
  expect(
    await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, document.id)),
  ).toEqual([]);
  const retry = await post(input.owner.token, "/documents", {
    ...create,
    initialSync: { ...sync.request, minLsn: await readCurrentCommitLsn(db) },
  });
  expect(retry.result.status).toBe(200);
  expect(await storedUpdates(document.id)).toEqual([{ id: sync.id }]);
});

test("an unsatisfied carried-sync minLsn rolls back binding and update", async () => {
  const input = await fixture();
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    ...input,
    blobId,
    stagedBlob: await stageBlob(input.owner, blobId),
  });
  const sync = await createFirstUpdateSyncRequest(input);
  const { events, result } = await traceSyncQueries(db, (database) =>
    bindBlobAttachment(
      { ...blobAttachmentTestRuntime, db: database },
      {
        blobId,
        fingerprint: input.owner.fingerprint,
        userId: input.owner.userId,
        sessionId: "sync-min-lsn-test",
        request: {
          ...request,
          documentSync: { ...sync.request, minLsn: unreachableMinLsn },
        },
      },
    ).catch((error: unknown) => error),
  );
  expect(result).toMatchObject({ status: 503, message: minLsnError });
  expect(commitLsnEvents(events).map(({ scope }) => scope)).toEqual([
    "transaction",
  ]);
  expect(events).toContainEqual({ kind: "rolledBack" });
  expect(await storedUpdates(input.document.id)).toEqual([]);
  expect(
    await db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.blobId, blobId)),
  ).toEqual([]);
  const retry = await bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId,
    fingerprint: input.owner.fingerprint,
    userId: input.owner.userId,
    sessionId: "sync-min-lsn-test",
    request: {
      ...request,
      documentSync: { ...sync.request, minLsn: await readCurrentCommitLsn(db) },
    },
  });
  expect(retry.documentSync?.acceptedOutgoingUpdateIds).toEqual([sync.id]);
});
