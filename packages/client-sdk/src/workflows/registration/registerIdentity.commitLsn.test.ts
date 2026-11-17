import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/data/execSqlClient";
import {
  PROVISIONING_COMMIT_LSN,
  respondToRegistration,
} from "../../../test/helpers/data/organizationProvisioningResponder";
import { registerIdentity } from "./registerIdentity";

test("every document registration seeds keeps the provisioning commit position", async () => {
  const { execSql, close } = await createTestExecSql("registration-commit-lsn");
  try {
    const response = await registerIdentity({
      identityTrustDomain: "https://api.example.test",
      apiClient: { registerUser: (...args) => respondToRegistration(args) },
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      pinLocalUserIdentity: async () => undefined,
      provisionedSystemContainers: [
        {
          icon: "trash",
          name: "Trash",
          slotDefinition: {
            namespace: "tearleads.explorer",
            projectorId: "explorer",
            slotId: "trash",
            version: 1,
          },
        },
      ],
      signingKeyPair: generateSigningSeedAndKeyPair(),
    });
    if (!response) throw new Error("Expected acknowledged registration");
    const seeded = [
      response.rootMetadataDocumentId,
      response.rosterProfileContainer?.metadataDocument.id,
      response.rosterProfileDocumentId,
      response.organizationMetadataContainer.metadataDocument.id,
      response.organizationProfileDocumentId,
      ...response.systemContainers.map(
        ({ metadataDocument }) => metadataDocument.id,
      ),
    ];
    const seededDocumentIds = seeded.filter(
      (id): id is string => typeof id === "string",
    );
    expect(seededDocumentIds).toHaveLength(seeded.length);
    expect(seededDocumentIds).toHaveLength(6);

    const rows = await execSql(
      `SELECT document_id AS "documentId", last_commit_lsn AS "lastCommitLsn",
        content_key_bundle IS NOT NULL AND document_kek_targets IS NOT NULL
          AND document_manifest_bundle IS NOT NULL AS "readable"
       FROM documents WHERE document_id IS NOT NULL`,
    );
    // Each one can skip its first read: a commit position and all three
    // bundle fields are stored.
    expect(
      rows.toSorted((left, right) =>
        String(Reflect.get(left, "documentId")).localeCompare(
          String(Reflect.get(right, "documentId")),
          "en",
        ),
      ),
    ).toEqual(
      seededDocumentIds.toSorted().map((documentId) => ({
        documentId,
        lastCommitLsn: PROVISIONING_COMMIT_LSN,
        readable: 1,
      })),
    );
  } finally {
    close();
  }
});
