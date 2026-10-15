import { expect, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
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
  // 41 / 42, 64 / 65, and 46 / 47 after.
  expect(create.statements).toBeLessThanOrEqual(43);
  expect(write.statements).toBeLessThanOrEqual(66);
  expect(pull.statements).toBeLessThanOrEqual(48);
}, 30_000);
