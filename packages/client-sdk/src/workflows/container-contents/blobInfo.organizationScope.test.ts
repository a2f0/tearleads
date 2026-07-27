import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { listBlobInfo } from "./blobInfo";
import { defaultContainerContentsPersistence } from "./containerPersistence";

async function saveOrganizationContainer(input: {
  containerId: string;
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  organizationId: string;
}) {
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.containerId,
      metadataDocumentId: null,
      name: input.organizationId,
      organizationId: input.organizationId,
      parentId: null,
    },
    null,
  );
}

async function saveOrganizationBlob(input: {
  blobId: string;
  containerId: string;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  localId: string;
  storageKey: string;
}) {
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    accessEpoch: 1,
    accessStateHash: null,
    containerId: input.containerId,
    documentId: `${input.localId}-remote`,
    documentKind: "note",
    id: input.localId,
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: input.localId,
    title: input.localId,
  });
  await sqlDocumentsPersistence.saveLocalAttachment(input.execSql, {
    blobId: input.blobId,
    byteLength: 12,
    detachedAt: null,
    localId: input.localId,
    mimeType: "image/png",
    slotId: "image",
    storageKey: input.storageKey,
  });
}

test("listBlobInfo spans every organization in the identity-local projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-blob-info-organization-scope-test",
  );

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveOrganizationContainer({
      containerId: "personal-container",
      execSql,
      organizationId: "personal-organization",
    });
    await saveOrganizationContainer({
      containerId: "custom-container",
      execSql,
      organizationId: "custom-organization",
    });
    await saveOrganizationBlob({
      blobId: "personal-blob",
      containerId: "personal-container",
      execSql,
      localId: "personal-document",
      storageKey: "personal-storage",
    });
    await saveOrganizationBlob({
      blobId: "custom-blob",
      containerId: "custom-container",
      execSql,
      localId: "custom-document",
      storageKey: "custom-storage",
    });

    // The blob browser calls this identity-wide query without a current-org or
    // destination-container filter, so both locally readable orgs are visible.
    const info = await listBlobInfo({ execSql });

    expect(info.totalCount).toBe(2);
    expect(info.rows.map((row) => row.blobId).sort()).toEqual([
      "custom-blob",
      "personal-blob",
    ]);
    expect(
      info.rows
        .flatMap((row) => row.references)
        .map((reference) => reference.containerId)
        .sort(),
    ).toEqual(["custom-container", "personal-container"]);
  } finally {
    close();
  }
});
