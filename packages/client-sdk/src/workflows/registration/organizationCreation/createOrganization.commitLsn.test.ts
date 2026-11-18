import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../../test/helpers/data/execSqlClient";
import {
  PROVISIONING_COMMIT_LSN,
  respondToOrganizationProvisioning,
} from "../../../../test/helpers/data/organizationProvisioningResponder";
import { createOrganization } from "./createOrganization";

test("an additional organization records no commit position for its seeded documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-create-commit-lsn",
  );
  try {
    const response = await createOrganization({
      identityTrustDomain: "https://api.example.test",
      apiClient: {
        // Even a stray position in the response is not recorded: another
        // session of this user may edit the new documents before this device
        // subscribes to them, so each is read once.
        createOrganization: async (request) => ({
          ...(await respondToOrganizationProvisioning(request)),
          commitLsn: PROVISIONING_COMMIT_LSN,
          commitLsnMode: "tracked",
        }),
      },
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: generateSigningSeedAndKeyPair(),
      userId: crypto.randomUUID(),
    });
    if (!response) throw new Error("Expected an acknowledged organization");
    const rows = await execSql(
      `SELECT document_id AS "documentId", last_commit_lsn AS "lastCommitLsn"
       FROM documents WHERE document_id IS NOT NULL`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toContainEqual({
      documentId: response.rootMetadataDocumentId,
      lastCommitLsn: null,
    });
    expect(
      rows.filter((row) => Reflect.get(row, "lastCommitLsn") !== null),
    ).toEqual([]);
  } finally {
    close();
  }
});
