import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { listContainerDocuments } from "./listContainerDocuments";
import { listContainers } from "./listContainers";

async function createLinkedDocument(input: {
  containerId: string;
  createdByFingerprint: string;
  organizationId: string;
}) {
  return createCurrentDocumentProjection({
    containerIds: [input.containerId],
    createdByFingerprint: input.createdByFingerprint,
    organizationId: input.organizationId,
  });
}

test("listContainers passes its runtime executor into metadata access resolution", async () => {
  const { registration } = await registerServiceUser();
  const recording = createRecordingDb();
  const containers = await listContainers(
    createServiceTestRuntime(recording.db),
    registration.userId,
  );

  expect(containers.items.map((container) => container.id)).toContain(
    registration.rootContainerId,
  );
  expect(recording.calls.get("execute") ?? 0).toBeGreaterThan(0);
});

test("listContainerDocuments passes its runtime executor into access resolution", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createLinkedDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
  });
  const recording = createRecordingDb();
  const listedDocuments = await listContainerDocuments(
    createServiceTestRuntime(recording.db),
    registration.rootContainerId,
    registration.userId,
  );

  expect(
    listedDocuments.items.map((listedDocument) => listedDocument.id),
  ).toContain(document.id);
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});
