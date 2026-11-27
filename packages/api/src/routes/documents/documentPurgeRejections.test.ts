import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import {
  buildDocumentPurgeRequest,
  postDocumentPurge,
} from "../../../test/helpers/documentPurge";
import {
  countDocumentRows,
  countTombstones,
} from "../../../test/helpers/documentPurgeFootprint";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import type { StoredContainerMutation } from "../../../test/helpers/storedContainerMutation";
import { routeApp } from "../../routeApp";

async function linkDocumentToSecondContainer(input: {
  readonly child: StoredContainerMutation;
  readonly createdDocument: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<void> {
  const request = await buildDocumentLinkRequest(input);
  const response = await routeApp.request(
    `/documents/${input.createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(response.status).toBe(200);
  expect(isDocumentLinkSetMutationResponse(await response.json())).toBe(true);
}

test("POST document purge rejects a document linked to more than one container", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  await linkDocumentToSecondContainer({
    child,
    createdDocument: created,
    owner,
    root,
  });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.currentDocumentLinks).toBe(2);

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Document must be linked to a single container before it can be purged",
  });

  // Nothing was deleted: the full per-document footprint is unchanged.
  const after = await countDocumentRows(created.id);
  expect(after).toEqual(before);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("POST document purge rejects callers without container write access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(outsider);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const response = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: outsider.token,
  });

  expect([403, 404]).toContain(response.status);

  const after = await countDocumentRows(created.id);
  expect(after.documents).toBe(1);
  expect(after.currentDocumentLinks).toBe(1);
  expect(after.accessManifests).toBeGreaterThan(0);
  expect(after.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("POST document purge returns 404 for an unknown document id", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await postDocumentPurge({
    documentId: crypto.randomUUID(),
    documentManifestHash: "0".repeat(64),
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Document not found" });
});

// An access event is stored as it was signed, and Postgres takes no U+0000
// in `text`: left to the store, such an event would be a server error. The
// event parser bounds the two strings a signer chooses freely, so the
// request is refused for its shape. The signer holds an event to the same
// bounds, so each is sent here under the signature it had.
test("POST document purge refuses an event whose names no store holds", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const request = await buildDocumentPurgeRequest({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
  });
  const before = await countDocumentRows(created.id);

  for (const [key, name, reason] of [
    ["signerDeviceId", "dev\u0000ice", "may not hold a control character"],
    ["eventId", "ev\u0000ent", "may not hold a control character"],
    ["signerDeviceId", "d".repeat(129), "may be at most 128 characters"],
    ["eventId", "e".repeat(129), "may be at most 128 characters"],
  ] as const) {
    const response = await routeApp.request(`/documents/${created.id}/purge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        event: { ...request.event, [key]: name },
      }),
    });
    expect([response.status, await response.json()]).toEqual([
      400,
      { error: `access event.${key} ${reason}` },
    ]);
  }
  expect(await countDocumentRows(created.id)).toEqual(before);
});
