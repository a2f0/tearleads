import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildMetadataDocumentCreateRequest } from "../../../test/helpers/containerCreateRequests";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { createFirstUpdateSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { runCreateContainerWithMetadataDocumentWorkflow } from "../../workflows/containers/mutations/createContainerWithMetadataDocument";

// Counts only real driver statements, never fixture readback queries.
test("metadata create reuses its freshly locked rows for the carried seed", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const container = await buildChildCreateRequest({ root, signer: owner });
  const containerId = String(Reflect.get(container.event, "objectId"));
  const metadataDocument = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest: container,
    parent: root.bundle,
    signer: owner,
  });
  const document = {
    accessManifest: { state: metadataDocument.manifest },
    contentKeyBundle: metadataDocument.contentKeyBundle,
    id: String(Reflect.get(metadataDocument.manifest, "objectId")),
  } as unknown as CreatedDocumentFixture;
  const seed = await createFirstUpdateSyncRequest({
    document,
    owner,
    root,
    authorizingContainerPathRefs: metadataDocument.targetContainerPathRefs
      ? [metadataDocument.targetContainerPathRefs]
      : undefined,
  });
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, () =>
    runCreateContainerWithMetadataDocumentWorkflow(db, {
      fingerprint: owner.fingerprint,
      userId: owner.userId,
      request: {
        container,
        metadataDocument,
        initialMetadataSync: seed.request,
      },
    }),
  );
  expect(result.response.container.containerId).toBe(containerId);
  expect(result.response.metadataDocument.id).toBe(document.id);
  expect(result.response.metadataDocument.manifestHash).toBe(
    metadataDocument.expectedManifestHash,
  );
  expect(
    result.response.metadataDocument.initialSync?.acceptedOutgoingUpdateIds,
  ).toEqual([seed.id]);
  expect(
    await db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, document.id)),
  ).toEqual([{ id: seed.id }]);
  console.info("locked-head-metadata-seed", counter.statements);
  expect(counter.statements).toBeLessThanOrEqual(
    84 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);

test("provisioning seeds reuse each newly created document's locked paths", async () => {
  const owner = createTestUser();
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, () => registerUser(owner));
  const rows = await db
    .select({ documentId: documents.id, updateId: documentUpdates.id })
    .from(documents)
    .leftJoin(documentUpdates, eq(documentUpdates.documentId, documents.id))
    .where(eq(documents.createdByFingerprint, owner.fingerprint));
  expect(rows.length).toBe(2);
  expect(rows.every((row) => row.updateId !== null)).toBe(true);
  expect(new Set(rows.map((row) => row.documentId)).size).toBe(rows.length);
  console.info(
    "locked-head-provisioned-seeds",
    JSON.stringify({ statements: counter.statements, documents: rows.length }),
  );
  expect(counter.statements).toBeLessThanOrEqual(
    237 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
}, 30_000);
