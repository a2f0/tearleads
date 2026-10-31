import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createDiscoveredDocumentVerifier } from "../container-contents/documentDiscovery/documentDiscoveryEvidence";
import { createOrganization } from "../organizations/provisioning/createOrganization";

type SeededDocument = NonNullable<
  CreateOrganizationResponse["organizationProfileDocument"]
>;

function seededDocuments(response: CreateOrganizationResponse | null) {
  const documents = [
    [response?.rosterProfileDocument, response?.rosterProfileContainerId],
    [
      response?.organizationProfileDocument,
      response?.organizationMetadataContainerId,
    ],
  ] as const;
  return documents.map(([document, containerId]) => {
    if (!document || !containerId)
      throw new Error("Expected seeded profile documents");
    return { containerId, document };
  });
}

async function provision(
  execSql: ExecSql,
  respond: typeof respondToOrganizationProvisioning = respondToOrganizationProvisioning,
) {
  return createOrganization({
    apiClient: { createOrganization: respond },
    dbClient: execSqlClientFromExecSql(execSql),
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    logError: () => undefined,
    signingKeyPair: generateSigningSeedAndKeyPair(),
    userId: crypto.randomUUID(),
  });
}

function listed(document: SeededDocument, containerId: string) {
  return {
    documentId: document.id,
    containerId,
    listedContainerIds: [containerId],
    // Provisioning creates every seeded head at access epoch 1.
    accessEpoch: 1,
    accessStateHash: document.manifestHash,
    // Listing fields are untrusted hints; only the signed head names links.
    linkedContainerIds: ["forged-container"],
    createdAt: document.createdAt,
  };
}

test("provisioning seeds the signed heads of the documents it authored", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioning-discovery-heads",
  );
  try {
    const response = await provision(execSql);
    if (!response) throw new Error("Expected a provisioning response");
    const store = createDocumentDiscoveryEvidenceStore(execSql);
    for (const { containerId, document } of seededDocuments(response)) {
      expect(await store.loadHead(document.id, document.manifestHash)).toEqual({
        organizationId: response.organizationId,
        accessEpoch: 1,
        accessStateHash: document.manifestHash,
        linkedContainerIds: [containerId],
      });
      let fetched = 0;
      const verify = createDiscoveredDocumentVerifier(
        response.organizationId,
        async () => {
          fetched += 1;
          return null;
        },
        async () => 1,
        store,
      );
      const result = await verify(
        [listed(document, containerId)],
        [containerId],
        await store.begin(),
      );
      expect(fetched).toBe(0);
      expect(result.inputs).toEqual([
        expect.objectContaining({
          documentId: document.id,
          containerId,
          linkedContainerIds: [containerId],
        }),
      ]);
      expect(await result.commit()).toBe(true);
    }
  } finally {
    close();
  }
});

test("a seeded head is not reused once its access checkpoint moves", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioning-discovery-heads-checkpoint",
  );
  try {
    const response = await provision(execSql);
    const [seeded] = seededDocuments(response);
    if (!seeded) throw new Error("Expected a seeded document");
    const { document } = seeded;
    await execSql(
      "UPDATE access_manifest_checkpoints SET epoch = 2, manifest_hash = 'later-head' WHERE object_kind = 'document' AND object_id = ?",
      [document.id],
    );
    expect(
      await createDocumentDiscoveryEvidenceStore(execSql).loadHead(
        document.id,
        document.manifestHash,
      ),
    ).toBeNull();
  } finally {
    close();
  }
});

test("an acknowledgement for a different document head seeds nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "provisioning-discovery-heads-mismatch",
  );
  try {
    let tampered: SeededDocument | undefined;
    await expect(
      provision(execSql, async (request) => {
        const response = await respondToOrganizationProvisioning(request);
        const document = response.organizationProfileDocument;
        if (!document) throw new Error("Expected an organization profile");
        tampered = { ...document, manifestHash: "server-substituted-head" };
        return { ...response, organizationProfileDocument: tampered };
      }),
    ).rejects.toThrow();
    if (!tampered) throw new Error("Expected a provisioning response");
    const store = createDocumentDiscoveryEvidenceStore(execSql);
    expect(await store.loadHead(tampered.id, tampered.manifestHash)).toBeNull();
    expect(
      await execSql("SELECT COUNT(*) AS count FROM document_discovery_heads"),
    ).toEqual([{ count: 0 }]);
  } finally {
    close();
  }
});
