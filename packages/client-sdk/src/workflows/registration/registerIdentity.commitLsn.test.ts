import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import { execSqlClientFromExecSql } from "../../../test/helpers/data/execSqlClient";
import {
  PROVISIONING_COMMIT_LSN,
  respondToRegistration,
} from "../../../test/helpers/data/organizationProvisioningResponder";
import { registerIdentity } from "./registerIdentity";

async function seededCommitLsns(
  commitLsn: string | null,
): Promise<{ readonly expected: string[]; readonly rows: unknown[] }> {
  const { execSql, close } = await createTestExecSql(
    `registration-commit-lsn-${commitLsn ?? "none"}`,
  );
  try {
    const response = await registerIdentity({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      identityTrustDomain: "https://api.example.test",
      apiClient: {
        registerUser: async (...args) => ({
          ...(await respondToRegistration(args)),
          ...(commitLsn === null ? { commitLsn: null } : {}),
        }),
      },
      containerId: crypto.randomUUID(),
      dbClient: execSqlClientFromExecSql(execSql),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      pinLocalUserIdentity: async () => undefined,
      provisionedSystemContainers: [
        {
          icon: "trash",
          name: "Trash",
          slotNamespace: "tearleads.organization-trash",
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
    const expected = seeded.filter(
      (id): id is string => typeof id === "string",
    );
    expect(expected).toHaveLength(6);
    const rows = await execSql(
      `SELECT document_id AS "documentId", last_commit_lsn AS "lastCommitLsn",
        content_key_bundle IS NOT NULL AND document_kek_targets IS NOT NULL
          AND document_manifest_bundle IS NOT NULL AS "readable"
       FROM documents WHERE document_id IS NOT NULL`,
    );
    return {
      expected: expected.toSorted(),
      rows: rows.toSorted((left, right) =>
        String(Reflect.get(left, "documentId")).localeCompare(
          String(Reflect.get(right, "documentId")),
          "en",
        ),
      ),
    };
  } finally {
    close();
  }
}

test("every document registration seeds keeps the provisioning commit position", async () => {
  const { expected, rows } = await seededCommitLsns(PROVISIONING_COMMIT_LSN);
  // Each one can skip its first read: a commit position and all three bundle
  // fields are stored.
  expect(rows).toEqual(
    expected.map((documentId) => ({
      documentId,
      lastCommitLsn: PROVISIONING_COMMIT_LSN,
      readable: 1,
    })),
  );
});

test("a response without a position leaves every seeded document to be read", async () => {
  // A replayed create, or a position the server could not read after commit.
  const { expected, rows } = await seededCommitLsns(null);
  expect(rows).toEqual(
    expected.map((documentId) => ({
      documentId,
      lastCommitLsn: null,
      readable: 1,
    })),
  );
});
