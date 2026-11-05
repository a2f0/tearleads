import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("purge proof rejects unauthorized callers before loading document history", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(outsider);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
  });
  expect(purgeResponse.status).toBe(200);

  await db
    .update(accessManifests)
    .set({ state: {} })
    .where(
      and(
        eq(accessManifests.objectKind, "document"),
        eq(accessManifests.objectId, created.id),
      ),
    );

  const unauthorizedResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${outsider.token}` } },
  );
  expect(unauthorizedResponse.status).toBe(403);
  await expect(unauthorizedResponse.json()).resolves.toEqual({
    error: "Forbidden",
  });

  const ownerResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(ownerResponse.status).toBe(409);
});
