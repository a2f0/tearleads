import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registeredRoot(): Promise<{
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  return { owner, root: await bootstrapRoot(owner) };
}

/** A create whose seed is a signed update holding the new document's content. */
async function seededCreateRequest(input: {
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<{
  readonly request: DocumentCreateRequest;
  readonly updateId: string;
}> {
  const create = await createDocumentRequest(input);
  // The seed is signed against the create's own manifest and key bundle.
  const planned = {
    accessManifest: { state: create.manifest },
    contentKeyBundle: create.contentKeyBundle,
    id: String(Reflect.get(create.manifest, "objectId")),
  } as unknown as DocumentCreateResponse;
  const { request: seed, updateId } = await createSignedDocumentSyncRequest({
    created: planned,
    owner: input.owner,
    root: input.root,
  });
  const [update] = seed.outgoingUpdates;
  if (!update) throw new Error("Expected a seed update");
  return {
    request: {
      ...create,
      initialSync: {
        ...seed,
        localVersionVector: update.partialEndVersionVector,
      },
    },
    updateId,
  };
}

function postCreate(owner: TestUser, request: unknown): Promise<Response> {
  return Promise.resolve(
    routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }),
  );
}

async function storedUpdateIds(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
  return rows.map((row) => row.id);
}

test("a seeded create commits its seed in the create transaction", async () => {
  const { owner, root } = await registeredRoot();
  const { request, updateId } = await seededCreateRequest({ owner, root });

  const response = await postCreate(owner, request);
  expect(response.status).toBe(200);
  const created = (await response.json()) as DocumentCreateResponse;
  expect(created.initialSync?.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(created.initialSync?.commitLsnMode).toBeDefined();
  expect(await storedUpdateIds(created.id)).toEqual([updateId]);
}, 15_000);

test("a plain create reports no seed", async () => {
  const { owner, root } = await registeredRoot();
  const response = await postCreate(
    owner,
    await createDocumentRequest({ owner, root }),
  );
  expect(response.status).toBe(200);
  const created = (await response.json()) as DocumentCreateResponse;
  expect(created.initialSync).toBeUndefined();
  expect(await storedUpdateIds(created.id)).toEqual([]);
}, 15_000);

test("a seed the sync would refuse fails the whole create", async () => {
  const { owner, root } = await registeredRoot();
  const { request } = await seededCreateRequest({ owner, root });
  const seed = request.initialSync;
  if (!seed) throw new Error("Expected a seed");
  const documentId = String(Reflect.get(request.manifest, "objectId"));

  const response = await postCreate(owner, {
    ...request,
    initialSync: { ...seed, expectedTargetHash: "0".repeat(64) },
  });
  expect(response.status).toBe(409);
  expect(((await response.json()) as { code?: string }).code).toBe(
    "document_sync_state_stale",
  );
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId));
  expect(rows).toEqual([]);
}, 15_000);

test("a create seed must hold exactly one update", async () => {
  const { owner, root } = await registeredRoot();
  const { request } = await seededCreateRequest({ owner, root });
  const seed = request.initialSync;
  const [update] = seed?.outgoingUpdates ?? [];
  if (!seed || !update) throw new Error("Expected a seed update");

  const response = await postCreate(owner, {
    ...request,
    initialSync: {
      ...seed,
      outgoingUpdates: [update, { ...update, id: crypto.randomUUID() }],
    },
  });
  expect(response.status).toBe(400);
}, 15_000);

test("replaying a seeded create reports the committed manifest", async () => {
  const { owner, root } = await registeredRoot();
  const { request, updateId } = await seededCreateRequest({ owner, root });
  const first = await postCreate(owner, request);
  expect(first.status).toBe(200);
  const created = (await first.json()) as DocumentCreateResponse;

  // A lost response replays the same create; the client then adopts it and
  // its still-queued row syncs as an ordinary update.
  const replay = await postCreate(owner, request);
  expect(replay.status).toBe(409);
  expect(((await replay.json()) as { code?: string }).code).toBe(
    "document_manifest_already_exists",
  );
  expect(await storedUpdateIds(created.id)).toEqual([updateId]);
}, 15_000);
