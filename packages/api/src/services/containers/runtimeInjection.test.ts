import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { initializeDocumentAccess } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { documentContainerLinks, documents } from "../../schema";
import { registerPublicKey } from "../auth/registerPublicKey";
import { listContainerDocuments } from "./listContainerDocuments";
import { listContainers } from "./listContainers";

async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );

  return { registration, user };
}

async function createLinkedDocument(input: {
  containerId: string;
  createdByFingerprint: string;
}) {
  const [document] = await db
    .insert(documents)
    .values({
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning({ id: documents.id });

  if (!document) {
    throw new Error("Failed to create service test document");
  }

  await db.insert(documentContainerLinks).values({
    containerId: input.containerId,
    documentId: document.id,
  });
  await initializeDocumentAccess(document.id, db);

  return document;
}

test("listContainers passes its runtime executor into metadata access resolution", async () => {
  const { registration } = await registerServiceUser();
  const recording = createRecordingDb();
  const containers = await listContainers(
    createServiceTestRuntime(recording.db),
    registration.userId,
  );

  expect(containers.map((container) => container.id)).toContain(
    registration.rootContainerId,
  );
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});

test("listContainerDocuments passes its runtime executor into access resolution", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createLinkedDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
  });
  const recording = createRecordingDb();
  const listedDocuments = await listContainerDocuments(
    createServiceTestRuntime(recording.db),
    registration.rootContainerId,
    registration.userId,
  );

  expect(listedDocuments.map((listedDocument) => listedDocument.id)).toContain(
    document.id,
  );
  expect(recording.calls.get("execute") ?? 0).toBeGreaterThan(0);
});
