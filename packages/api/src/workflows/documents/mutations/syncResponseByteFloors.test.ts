import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../../test/helpers/authenticate";
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
  const createResponse = await post(
    owner.token,
    "/documents",
    await createDocumentRequest({ owner, root }),
  );
  const created = await createResponse.json();
  invariant(isDocumentCreateResponse(created), "expected created document");
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
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
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
  const slack = entries.map((entry) => {
    const floor = floors.get(String(Reflect.get(entry, "id")));
    invariant(floor !== undefined, "expected a floor for every served update");
    return Buffer.byteLength(JSON.stringify(entry), "utf8") - floor;
  });
  expect(slack.length).toBeGreaterThanOrEqual(3);
  // What a floor leaves out is keys, ids, epochs, and timestamps: measured
  // as 312 bytes for an ordinary entry and 420 for a checkpoint.
  for (const bytes of slack) {
    expect(bytes).toBeGreaterThanOrEqual(0);
    expect(bytes).toBeLessThan(512);
  }
}, 30_000);
