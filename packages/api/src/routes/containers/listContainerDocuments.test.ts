import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containers } from "../../schema";

async function getContainerOrganizationId(containerId: string) {
  const [container] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  invariant(container, "expected container row");
  return container.organizationId;
}

test("GET /containers/:containerId/documents lists current manifest-linked documents", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const createdDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint: await toFingerprint(owner.signing.signingPublicKey),
    epoch: 2,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId: await getContainerOrganizationId(owner.rootContainerId),
  });

  const response = await routeApp.request(
    `/containers/${owner.rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        currentAccessEpoch: 2,
        currentAccessStateHash: createdDocument.manifestHash,
        id: createdDocument.id,
        linkedContainerIds: [owner.rootContainerId],
      }),
    ],
    nextCursor: expect.any(String),
    tombstones: [],
  });
});

test("GET /containers/:containerId/documents rejects users without manifest access", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  const response = await routeApp.request(
    `/containers/${owner.rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${otherUser.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});
