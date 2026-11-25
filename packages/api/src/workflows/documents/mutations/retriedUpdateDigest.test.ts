import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../../../test/helpers/documentAcknowledgementFixture";
import { traceDocumentCreate } from "../../../../test/helpers/documentCreateTouchFixture";
import { peerSpan } from "../../../../test/helpers/documentPeerOwnership";
import { createSignedDocumentSyncRequest } from "../../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";

const CONTENT_COLUMNS = [
  "encrypted_data",
  "dependency_version_vector",
  "partial_start_version_vector",
  "partial_end_version_vector",
  "plaintext_hash",
];

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

async function writtenUpdate() {
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
  const { request } = await createSignedDocumentSyncRequest({
    created,
    declaredSpan: peerSpan("5150", 0, 3),
    owner,
    root,
  });
  const path = `/documents/${created.id}/sync`;
  expect((await post(owner.token, path, request)).status).toBe(200);
  return { owner, path, request };
}

/**
 * The read that matches a request's update ids against stored rows: the one
 * that selects each named row's document to refuse ids from other documents.
 */
function existingRowLookups(queries: readonly { readonly sql: string }[]) {
  return queries.filter(({ sql }) => {
    const from = sql.indexOf(' from "document_updates" where ');
    return (
      sql.startsWith("select ") &&
      from > 0 &&
      sql.slice(0, from).includes('"document_id"') &&
      sql.includes('"document_updates"."id" in')
    );
  });
}

test("a retried update is matched by digest without loading stored content", async () => {
  const { owner, path, request } = await writtenUpdate();

  const retry = await traceDocumentCreate(async () =>
    post(owner.token, path, request),
  );

  expect(retry.result.status).toBe(200);
  expect((await retry.result.json()).acceptedOutgoingUpdateIds).toEqual(
    request.outgoingUpdates.map((update) => update.id),
  );
  const lookups = existingRowLookups(retry.queries);
  expect(lookups.length).toBeGreaterThan(0);
  for (const { sql } of lookups) {
    for (const column of CONTENT_COLUMNS) {
      const reference = `"${column}"`;
      // Each content column appears once, inside its digest, never bare.
      expect(sql).toContain(`sha256(convert_to(${reference}, 'UTF8'))`);
      expect(sql.split(reference)).toHaveLength(2);
    }
  }
}, 30_000);

test("a retried id whose content changed is still an id conflict", async () => {
  const { owner, path, request } = await writtenUpdate();
  const [update, ...rest] = request.outgoingUpdates;
  invariant(update, "expected an outgoing update");

  const response = await post(owner.token, path, {
    ...request,
    outgoingUpdates: [
      { ...update, encryptedData: `${update.encryptedData}A` },
      ...rest,
    ],
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_update_id_conflict",
  });
}, 30_000);
