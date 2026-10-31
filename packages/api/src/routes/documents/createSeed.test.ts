import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import {
  computeDocumentContentRecordCiphertextHash,
  signWriteHeader,
  type UnsignedWriteHeader,
} from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";
import { OrganizationSyncDisabledError } from "../../workflows/billing/organizationSyncEligibility";
import {
  commitDocumentCreateSeedInTransaction,
  createDocumentWithExecutor,
} from "../../workflows/documents/mutations/createDocument";

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
  } as unknown as CreatedDocumentFixture;
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

test("a seed skips its billing check only for the organization the create admitted", async () => {
  const { owner, root } = await registeredRoot();
  const { request } = await seededCreateRequest({ owner, root });
  const organizationId = String(
    Reflect.get(request.manifest, "organizationId"),
  );
  await setTestOrganizationBillingLocal(organizationId);
  const seedAfterCreate = (syncEligibleOrganizationId: string) =>
    db.transaction(async (tx) => {
      const { created } = await createDocumentWithExecutor({
        executor: tx,
        fingerprint: owner.fingerprint,
        request,
        userId: owner.userId,
      });
      return commitDocumentCreateSeedInTransaction({
        documentId: created.id,
        executor: tx,
        fingerprint: owner.fingerprint,
        seed: request.initialSync,
        syncEligibleOrganizationId,
        userId: owner.userId,
      });
    });

  // Admitting another organization does not cover this one's lapsed billing.
  await expect(seedAfterCreate(crypto.randomUUID())).rejects.toBeInstanceOf(
    OrganizationSyncDisabledError,
  );
  // The organization the caller admitted is not checked twice.
  await expect(seedAfterCreate(organizationId)).resolves.toMatchObject({
    insertedUpdateIds: [expect.any(String)],
  });
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

/** The seed as a client re-sends its row: the same id, freshly encrypted. */
async function reencryptedSeed(
  owner: TestUser,
  seed: NonNullable<DocumentCreateRequest["initialSync"]>,
): Promise<NonNullable<DocumentCreateRequest["initialSync"]>> {
  const [update] = seed.outgoingUpdates;
  if (!update) throw new Error("Expected a seed update");
  const encryptedData = `${update.encryptedData}:fresh-iv`;
  const { signature: _signature, ...header } = update.writeHeader;
  const writeHeader = await signWriteHeader(
    {
      ...(header as unknown as UnsignedWriteHeader),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
    },
    owner.signing.signingPrivateKey,
  );
  return {
    ...seed,
    outgoingUpdates: [
      {
        ...update,
        encryptedData,
        writeHeader: writeHeader as unknown as Record<string, unknown>,
      },
    ],
  };
}

test("a committed seed re-sent by a sync takes the update-id conflict", async () => {
  const { owner, root } = await registeredRoot();
  const { request, updateId } = await seededCreateRequest({ owner, root });
  const seed = request.initialSync;
  if (!seed) throw new Error("Expected a seed");
  const first = await postCreate(owner, request);
  expect(first.status).toBe(200);
  const created = (await first.json()) as DocumentCreateResponse;

  // Only a byte-identical re-send is a retry of the seed.
  const retried = await postDocumentSync(owner, created.id, seed);
  expect(retried.status).toBe(200);

  // After a lost create response the adopted row syncs re-encrypted, so the
  // server cannot treat it as a retry of the seed; client recovery settles or
  // re-keys the row, and the duplicate ops import idempotently.
  const resent = await postDocumentSync(
    owner,
    created.id,
    await reencryptedSeed(owner, seed),
  );
  expect(resent.status).toBe(409);
  expect(((await resent.json()) as { code?: string }).code).toBe(
    "document_sync_update_id_conflict",
  );
  expect(await storedUpdateIds(created.id)).toEqual([updateId]);
}, 15_000);

/** Every field within its own bound; only the serialized seed is too large. */
function oversizedSeed(
  seed: NonNullable<DocumentCreateRequest["initialSync"]>,
): NonNullable<DocumentCreateRequest["initialSync"]> {
  const [update] = seed.outgoingUpdates;
  if (!update) throw new Error("Expected a seed update");
  return {
    ...seed,
    outgoingUpdates: [
      {
        ...update,
        encryptedData: "a".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES - 64),
      },
    ],
  };
}

test("a create seed over the sync request limit is refused before the create", async () => {
  const { owner, root } = await registeredRoot();
  const { request } = await seededCreateRequest({ owner, root });
  const seed = request.initialSync;
  if (!seed) throw new Error("Expected a seed");
  const documentId = String(Reflect.get(request.manifest, "objectId"));

  const response = await postCreate(owner, {
    ...request,
    initialSync: oversizedSeed(seed),
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId));
  expect(rows).toEqual([]);
}, 30_000);

test("a container metadata seed over the sync request limit is refused", async () => {
  const { owner, root } = await registeredRoot();
  const { request } = await seededCreateRequest({ owner, root });
  const seed = request.initialSync;
  if (!seed) throw new Error("Expected a seed");

  const response = await routeApp.request(
    "/containers/with-metadata-document",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        container: await buildChildCreateRequest({ root, signer: owner }),
        initialMetadataSync: oversizedSeed(seed),
        metadataDocument: await createDocumentRequest({ owner, root }),
      }),
    },
  );
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
}, 30_000);
