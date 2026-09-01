import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { listBlobInfo } from "./blobInfo";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

const TEST_TIMESTAMP = "2026-07-13T12:00:00.000Z";

async function saveLocalAttachment(input: {
  blobId: string;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveLocalAttachment>[0];
  localId: string;
  slotId: string;
}) {
  await sqlDocumentsPersistence.saveLocalAttachment(input.execSql, {
    blobId: input.blobId,
    byteLength: 12,
    detachedAt: null,
    localId: input.localId,
    mimeType: "image/png",
    slotId: input.slotId,
    storageKey: `storage-${input.localId}-${input.slotId}`,
  });
}

async function saveDocument(input: {
  containerId: string;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  localId: string;
}) {
  await saveTestDocument({
    containerId: input.containerId,
    documentId: `document-${input.localId}`,
    execSql: input.execSql,
    id: input.localId,
    title: input.localId,
    updatedAt: TEST_TIMESTAMP,
  });
}

async function saveOrganizationContainer(input: {
  containerId: string;
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  organizationId: string;
}) {
  await saveTestContainer({
    execSql: input.execSql,
    id: input.containerId,
    name: input.containerId,
    organizationId: input.organizationId,
    parentId: null,
    timestamp: TEST_TIMESTAMP,
  });
}

test("listBlobInfo attributes blobs to their document container organizations", async () => {
  const { close, execSql } = await createTestExecSql(
    "blob-info-organization-attribution-test",
  );

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveOrganizationContainer({
      containerId: "personal-container",
      execSql,
      organizationId: "personal-org",
    });
    await saveOrganizationContainer({
      containerId: "custom-container",
      execSql,
      organizationId: "custom-org",
    });
    await saveDocument({
      containerId: "personal-container",
      execSql,
      localId: "personal-document",
    });
    await saveDocument({
      containerId: "custom-container",
      execSql,
      localId: "custom-document",
    });
    await saveLocalAttachment({
      blobId: "personal-blob",
      execSql,
      localId: "personal-document",
      slotId: "personal-slot",
    });
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 24,
      localId: "custom-document",
      mimeType: "application/pdf",
      name: "custom.pdf",
      slotId: "custom-slot",
      storageKey: "custom-storage",
    });

    const info = await listBlobInfo({ execSql });

    expect(
      Object.fromEntries(info.rows.map((row) => [row.key, row.organizationId])),
    ).toEqual({
      "blob:personal-blob": "personal-org",
      "storage:custom-storage": "custom-org",
    });
    await expect(
      listBlobInfo({ execSql, query: "CUSTOM-ORG" }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [{ organizationId: "custom-org" }],
    });
  } finally {
    close();
  }
});

test("listBlobInfo keeps org attribution after the container is removed", async () => {
  const { close, execSql } = await createTestExecSql(
    "blob-info-organization-attribution-retention-test",
  );

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveOrganizationContainer({
      containerId: "shared-container",
      execSql,
      organizationId: "peer-org",
    });
    await saveDocument({
      containerId: "shared-container",
      execSql,
      localId: "shared-document",
    });
    await saveLocalAttachment({
      blobId: "shared-blob",
      execSql,
      localId: "shared-document",
      slotId: "shared-slot",
    });

    // Access revocation tombstones the shared container; the blob row keeps
    // its last-known org attribution instead of falling back to "-".
    await defaultContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: "shared-container",
        reason: "access_revoked",
        updatedAt: TEST_TIMESTAMP,
      },
    ]);

    const info = await listBlobInfo({ execSql });
    expect(
      Object.fromEntries(
        info.rows.map((row) => [row.blobId, row.organizationId]),
      ),
    ).toEqual({ "shared-blob": "peer-org" });
    // Searching by the retained org must match the displayed attribution.
    await expect(
      listBlobInfo({ execSql, query: "PEER-ORG" }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [{ organizationId: "peer-org" }],
    });
  } finally {
    close();
  }
});

test("listBlobInfo leaves missing and ambiguous organization attribution null", async () => {
  const { close, execSql } = await createTestExecSql(
    "blob-info-organization-attribution-boundary-test",
  );

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveOrganizationContainer({
      containerId: "personal-container",
      execSql,
      organizationId: "personal-org",
    });
    await saveOrganizationContainer({
      containerId: "custom-container",
      execSql,
      organizationId: "custom-org",
    });
    for (const [containerId, localId] of [
      ["personal-container", "personal-document"],
      ["custom-container", "custom-document"],
      ["missing-container", "orphan-document"],
    ] as const) {
      await saveDocument({ containerId, execSql, localId });
    }
    await saveLocalAttachment({
      blobId: "ambiguous-blob",
      execSql,
      localId: "personal-document",
      slotId: "personal-slot",
    });
    await saveLocalAttachment({
      blobId: "ambiguous-blob",
      execSql,
      localId: "custom-document",
      slotId: "custom-slot",
    });
    await saveLocalAttachment({
      blobId: "known-plus-orphan-blob",
      execSql,
      localId: "personal-document",
      slotId: "known-slot",
    });
    await saveLocalAttachment({
      blobId: "known-plus-orphan-blob",
      execSql,
      localId: "orphan-document",
      slotId: "orphan-shared-slot",
    });
    await saveLocalAttachment({
      blobId: "orphan-blob",
      execSql,
      localId: "orphan-document",
      slotId: "orphan-slot",
    });

    const info = await listBlobInfo({ execSql });
    const organizationsByBlobId = Object.fromEntries(
      info.rows.map((row) => [row.blobId, row.organizationId]),
    );

    expect(organizationsByBlobId).toEqual({
      "ambiguous-blob": null,
      "known-plus-orphan-blob": null,
      "orphan-blob": null,
    });
  } finally {
    close();
  }
});
