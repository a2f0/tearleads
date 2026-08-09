import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifests,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessManifestState,
  KeyingCanonicalJson,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

test("container projection rejects a database-injected user grant", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  const root = await bootstrapRoot(owner);
  const state = root.bundle.state as unknown as ContainerAccessManifestState;

  await db
    .update(accessManifests)
    .set({
      state: {
        ...state,
        directGrants: [
          ...state.directGrants,
          {
            accessLevel: "admin",
            subjectId: outsider.userId,
            subjectType: "user",
          },
        ],
      } as unknown as KeyingCanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );

  expect(response.status).toBe(409);
});

test("document projection rejects a database-injected link", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db
    .update(accessManifests)
    .set({
      state: {
        ...created.accessManifest.state,
        linkedContainerIds: [root.kekState.containerId, crypto.randomUUID()],
      } as KeyingCanonicalJson,
    })
    .where(
      eq(accessManifests.manifestHash, created.accessManifest.manifestHash),
    );

  const response = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );

  expect(response.status).toBe(409);
});

test("container projection rejects a signer key edit after caching", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const projectionPath = `/containers/${root.kekState.containerId}/writer-projection`;

  const verifiedResponse = await routeApp.request(projectionPath, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(verifiedResponse.status).toBe(200);

  const replacementSigner = createTestUser();
  await db
    .update(users)
    .set({
      signingPublicKey: bytesToBase64(
        replacementSigner.signing.signingPublicKey,
      ),
    })
    .where(eq(users.id, owner.userId));

  const response = await routeApp.request(projectionPath, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(response.status).toBe(409);
});

test("document projection rejects a stored event signature edit", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const projectionPath = `/documents/${created.id}/writer-projection`;

  const verifiedResponse = await routeApp.request(projectionPath, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(verifiedResponse.status).toBe(200);

  await db
    .update(accessEvents)
    .set({ signature: "tampered-signature" })
    .where(eq(accessEvents.eventHash, created.accessManifest.event.eventHash));

  const response = await routeApp.request(projectionPath, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(response.status).toBe(409);
});

test("child projection accepts a historical parent pin after parent share", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const request = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });

  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(shareResponse.status).toBe(200);

  const projectionResponse = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(projectionResponse.status).toBe(200);
});
