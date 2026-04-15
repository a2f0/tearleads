import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  createPublicKeyRequest,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import { containerMetadataDocuments, containers } from "../../schema";
import { registerPublicKey } from "../auth/registerPublicKey";
import { createContainer } from "./createContainer";

test("createContainer service creates a metadata document without route helpers", async () => {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);
  const childId = crypto.randomUUID();

  const created = await createContainer(runtime, {
    id: childId,
    createdByFingerprint: fingerprint,
    initialMetadataUpdates: [],
    parentId: registration.rootContainerId,
    userId: registration.userId,
  });

  expect(created.id).toBe(childId);
  expect(created.parentId).toBe(registration.rootContainerId);
  expect(created.metadataAccessEpoch).toBe(1);
  expect(created.metadataRecipientEncapsulationPublicKeys).toHaveLength(1);

  const [container] = await db
    .select({
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, childId))
    .limit(1);
  expect(container?.parentId).toBe(registration.rootContainerId);

  const [metadataDocument] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, childId))
    .limit(1);
  expect(metadataDocument).toEqual({
    containerId: childId,
    documentId: created.metadataDocumentId,
  });
});
