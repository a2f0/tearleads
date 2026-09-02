import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  isContainerWriterProjectionResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { syncDocumentWithInlineRootRekey } from "../../test/helpers/coldSdkRematerialization";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

test("SDK document sync commits an inline root rekey against post-rekey targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const synced = await syncDocumentWithInlineRootRekey({
    containerId: root.kekState.containerId,
    organizationId,
    owner,
  });

  const rootResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const documentResponse = await routeApp.request(
    `/documents/${synced.documentId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const rootProjection: unknown = await rootResponse.json();
  const documentProjection: unknown = await documentResponse.json();

  expect(rootResponse.status).toBe(200);
  expect(isContainerWriterProjectionResponse(rootProjection)).toBe(true);
  expect(documentResponse.status).toBe(200);
  expect(isDocumentWriterProjectionResponse(documentProjection)).toBe(true);
  if (
    !isContainerWriterProjectionResponse(rootProjection) ||
    !isDocumentWriterProjectionResponse(documentProjection)
  ) {
    throw new Error("expected committed inline-rekey writer projections");
  }
  expect(rootProjection.path.at(-1)?.manifestHash).toBe(
    synced.rekeyManifestHash,
  );
  expect(
    documentProjection.documentKekTargets.linkedContainerManifestHashes,
  ).toEqual([synced.rekeyManifestHash]);
  expect(documentProjection.contentKeyBundle.targetHash).toBe(
    synced.documentTargetHash,
  );
  expect(documentProjection.contentKeyBundleStale).toBeUndefined();
}, 20_000);
