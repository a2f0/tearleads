import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { db } from "@tearleads/api-shared/postgres";
import { documentContentWriteHeaders } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../../../test/helpers/documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "../../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { listDocumentUpdateResponseByteFloors } from "../../../documents/documentUpdateByteFloors";
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

test("served sync entries carry at least their byte floors plus only fixed-size fields", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createRequest = await createDocumentRequest({ owner, root });
  const createResponse = await post(owner.token, "/documents", createRequest);
  const createdBody = await createResponse.json();
  invariant(isDocumentCreateResponse(createdBody), "expected created document");
  const created = withDocumentMutationArtifacts(createRequest, createdBody);
  for (const checkpoint of [true, false, false]) {
    const { request } = await createSignedDocumentSyncRequest({
      checkpoint,
      created,
      owner,
      root,
    });
    expect(
      (await post(owner.token, `/documents/${created.id}/sync`, request))
        .status,
    ).toBe(200);
  }

  const pull = await post(owner.token, `/documents/${created.id}/sync`, {
    contentKeyEpoch: created.contentKeyEpoch,
    expectedLinkSetManifestHash: created.manifestHash,
    expectedTargetHash: created.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
  });
  expect(pull.status).toBe(200);
  const entries: unknown = Reflect.get(await pull.json(), "updates");
  invariant(Array.isArray(entries), "expected served updates");
  const floors = await listDocumentUpdateResponseByteFloors(
    db,
    entries.map((entry) => String(Reflect.get(entry, "id"))),
  );
  // A floor bounds what a page loads, which includes a target set the
  // response omits because the client holds it; restore it before measuring.
  const storedTargets = new Map(
    (
      await db
        .select({
          id: documentContentWriteHeaders.updateId,
          targets: documentContentWriteHeaders.authorizationTargets,
        })
        .from(documentContentWriteHeaders)
        .where(
          inArray(
            documentContentWriteHeaders.updateId,
            entries.map((entry) => String(Reflect.get(entry, "id"))),
          ),
        )
    ).map((row) => [row.id, row.targets]),
  );
  const slack = entries.map((entry) => {
    const id = String(Reflect.get(entry, "id"));
    const floor = floors.get(id);
    invariant(floor !== undefined, "expected a floor for every served update");
    const loaded =
      "authorizationTargets" in entry
        ? entry
        : { ...entry, authorizationTargets: storedTargets.get(id) };
    return Buffer.byteLength(JSON.stringify(loaded), "utf8") - floor;
  });
  expect(slack.length).toBeGreaterThanOrEqual(3);
  // What a floor leaves out is keys, ids, epochs, timestamps, and a baseline
  // segment's group fields: measured as 312 bytes for an ordinary entry and
  // 571 for a baseline's final segment, which carries its baseline id, index,
  // count, digest and cursor.
  for (const bytes of slack) {
    expect(bytes).toBeGreaterThanOrEqual(0);
    expect(bytes).toBeLessThan(640);
  }
}, 30_000);
