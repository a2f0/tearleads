import { expect, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import {
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES } from "@tearleads/validators/util";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
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
  const result = await withDatabaseStatementCounter(counter, work);
  return { result, statements: counter.statements };
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
  const created = await create.result.json();
  invariant(isDocumentCreateResponse(created), "expected created document");

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
      contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: created.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    }),
  );
  expect(pull.result.status).toBe(200);

  // Measured with PGlite / SQLite: create 55 / 56, write 80 / 81, and pull
  // 58 / 59 before signer rows were read once per transaction, the KEK target
  // resolution stopped repeating, and the document head joined its links;
  // 41 / 42, 64 / 65, and 46 / 47 after. Create 39 / 40 / 41 (Postgres third),
  // then 37 / 38 / 39 once inserts verify their RETURNING rows. Write 57 / 58 /
  // 59 and pull 41 / 42 / 43 before the database efficiency audit's sync unit
  // resolved the targets once after the locks and reused the locked heads and
  // each transaction's manifest bundles: create 36 / 37 / 38,
  // write 47 / 48 / 49, pull 33 / 34 / 35. Bounds are Postgres.
  expect(create.statements).toBeLessThanOrEqual(38);
  expect(write.statements).toBeLessThanOrEqual(49);
  expect(pull.statements).toBeLessThanOrEqual(35);
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
  } as unknown as DocumentCreateResponse;
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
  // PGlite / SQLite / Postgres: 90 / 90 / 92 while the seed re-read the
  // document row, re-locked heads the create held, re-read billing the create
  // checked, built an unread pull page, and every lock and bundle read was
  // repeated; 67 / 67 / 69 once it reused them (after RETURNING checks).
  expect(seeded.statements).toBeLessThanOrEqual(69);
}, 30_000);

test("a full pull page loads its updates as sets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createRequest = await createDocumentRequest({ owner, root });
  const createResponse = await post(owner.token, "/documents", createRequest);
  expect(createResponse.status).toBe(200);
  const created = await createResponse.json();
  invariant(isDocumentCreateResponse(created), "expected created document");
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
      contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: created.contentKeyBundle.targetHash,
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
  // audit; 33 / 34 (Postgres 35) after.
  expect(pull.statements).toBeLessThanOrEqual(35);
}, 60_000);
