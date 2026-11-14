import { expect, test } from "bun:test";
import {
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES } from "@tearleads/validators/util";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  type CreatedDocumentFixture,
  withDocumentMutationArtifacts,
} from "../../../../test/helpers/documentAcknowledgementFixture";
import {
  seedTouchCounts,
  traceDocumentCreate,
  unseededTouchCount,
} from "../../../../test/helpers/documentCreateTouchFixture";
import { createSignedDocumentSyncRequest } from "../../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";

function post(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function counted<T>(work: () => T | Promise<T>) {
  const counter = { statements: 0 };
  const { result, queries } = await traceDocumentCreate(() =>
    withDatabaseStatementCounter(counter, async () => work()),
  );
  return { result, queries, statements: counter.statements };
}

test("document create, sync write, and sync pull stay within their statement budgets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const createRequest = await createDocumentRequest({ owner, root });
  const create = await counted(() =>
    post(owner.token, "/documents", createRequest),
  );
  expect(create.result.status).toBe(200);
  const createdBody = await create.result.json();
  invariant(isDocumentCreateResponse(createdBody), "expected created document");
  const created = withDocumentMutationArtifacts(createRequest, createdBody);

  expect(await unseededTouchCount(create.queries, created.id)).toBe(1);

  const first = await createSignedDocumentSyncRequest({ created, owner, root });
  const second = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  // The measured write is not the document's first.
  expect(
    (await post(owner.token, `/documents/${created.id}/sync`, first.request))
      .status,
  ).toBe(200);
  const write = await counted(() =>
    post(owner.token, `/documents/${created.id}/sync`, second.request),
  );
  expect(write.result.status).toBe(200);

  const pull = await counted(() =>
    post(owner.token, `/documents/${created.id}/sync`, {
      contentKeyEpoch: created.contentKeyEpoch,
      expectedLinkSetManifestHash: created.manifestHash,
      expectedTargetHash: created.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    }),
  );
  expect(pull.result.status).toBe(200);

  // Guard batching removes three create statements. The ordinary sync write
  // and pull retain their existing ceilings and fresh-resolution paths.
  console.info(
    "locked-head-create-baseline",
    JSON.stringify({
      create: create.statements,
      write: write.statements,
      pull: pull.statements,
    }),
  );
  expect(create.statements).toBeLessThanOrEqual(
    28 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(write.statements).toBeLessThanOrEqual(
    36 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(pull.statements).toBeLessThanOrEqual(
    25 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);

test("a rotation baseline write and its pull stay within their statement budgets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createRequest = await createDocumentRequest({ owner, root });
  const createResponse = await post(owner.token, "/documents", createRequest);
  expect(createResponse.status).toBe(200);
  const createdBody = await createResponse.json();
  invariant(isDocumentCreateResponse(createdBody), "expected created document");
  const created = withDocumentMutationArtifacts(createRequest, createdBody);

  // A full-history baseline starts from the empty frontier, so it is the
  // document's first write here.
  const { request: baseline } = await createSignedDocumentSyncRequest({
    checkpoint: true,
    created,
    owner,
    root,
  });
  const write = await counted(() =>
    post(owner.token, `/documents/${created.id}/sync`, baseline),
  );
  expect(write.result.status).toBe(200);
  const pull = await counted(() =>
    post(owner.token, `/documents/${created.id}/sync`, {
      contentKeyEpoch: created.contentKeyEpoch,
      expectedLinkSetManifestHash: created.manifestHash,
      expectedTargetHash: created.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    }),
  );
  expect(pull.result.status).toBe(200);
  const pulled = await pull.result.json();
  expect(
    pulled.updates.filter(
      (update: { checkpointKind?: string }) =>
        update.checkpointKind === "rotate_baseline",
    ),
  ).toHaveLength(1);

  // PGlite / SQLite / Postgres: write 50 / 51 / 52 and pull 34 / 35 / 36
  // while a baseline took a second insert into its own table and the pull
  // read that table for checkpoints; 48 / 49 / 50 and 33 / 34 / 35 once the
  // update row carries the baseline's source version vector. Batched history
  // and adjacent reads now use write 38 / 39 and pull 26 / 27 (PGlite /
  // SQLite), plus the Postgres transaction-control allowance.
  expect(write.statements).toBeLessThanOrEqual(
    38 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  expect(pull.statements).toBeLessThanOrEqual(
    26 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);

test("a seeded document create stays within its statement budget", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const create = await createDocumentRequest({ owner, root });
  // The seed is signed against the create's own manifest and key bundle.
  const planned = {
    accessManifest: { state: create.manifest },
    contentKeyBundle: create.contentKeyBundle,
    id: String(Reflect.get(create.manifest, "objectId")),
  } as unknown as CreatedDocumentFixture;
  const { request: seed } = await createSignedDocumentSyncRequest({
    created: planned,
    owner,
    root,
  });
  const [update] = seed.outgoingUpdates;
  invariant(update, "expected a seed update");
  const request: DocumentCreateRequest = {
    ...create,
    initialSync: {
      ...seed,
      localVersionVector: update.partialEndVersionVector,
    },
  };

  const seeded = await counted(() => post(owner.token, "/documents", request));
  expect(seeded.result.status).toBe(200);
  const body = await seeded.result.json();
  invariant(isDocumentCreateResponse(body), "expected seeded document");
  expect(body.id).toBe(planned.id);
  expect(body.manifestHash).toBe(create.expectedManifestHash);
  expect(body.initialSync?.acceptedOutgoingUpdateIds).toEqual([update.id]);
  expect(await seedTouchCounts(seeded.queries, [body.id])).toEqual([1]);
  console.info("locked-head-seeded-create", seeded.statements);
  // Reuse the create frontier, strict targets and stored bundle, not access or
  // signature checks. The public seed already touched its containers once.
  expect(seeded.statements).toBeLessThanOrEqual(
    43 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);

test("a full pull page loads its updates as sets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createRequest = await createDocumentRequest({ owner, root });
  const createResponse = await post(owner.token, "/documents", createRequest);
  expect(createResponse.status).toBe(200);
  const createdBody = await createResponse.json();
  invariant(isDocumentCreateResponse(createdBody), "expected created document");
  const created = withDocumentMutationArtifacts(createRequest, createdBody);
  // One more update than a page holds, so the measured page is full.
  for (
    let index = 0;
    index <= MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES;
    index++
  ) {
    const { request } = await createSignedDocumentSyncRequest({
      created,
      owner,
      root,
    });
    expect(
      (await post(owner.token, `/documents/${created.id}/sync`, request))
        .status,
    ).toBe(200);
  }

  const pull = await counted(() =>
    post(owner.token, `/documents/${created.id}/sync`, {
      contentKeyEpoch: created.contentKeyEpoch,
      expectedLinkSetManifestHash: created.manifestHash,
      expectedTargetHash: created.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    }),
  );
  expect(pull.result.status).toBe(200);
  const body = await pull.result.json();
  expect(Reflect.get(body, "updates")).toHaveLength(
    MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  );
  // Measured with PGlite / SQLite: 232 / 233 while a page loaded each update,
  // its write header, and its checkpoint separately; 44 / 45 once it sized
  // itself from stored byte lengths and loaded each as a set.
  // 41 / 42 (Postgres 43) before the sync unit of the database efficiency
  // audit; 33 / 34 (Postgres 35) after; 32 / 33 (Postgres 34) once
  // checkpoints rode on the update rows. Policy and adjacent-read batching
  // now uses 25 / 26 (PGlite / SQLite), plus the Postgres control statement.
  expect(pull.statements).toBeLessThanOrEqual(
    25 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 60_000);
