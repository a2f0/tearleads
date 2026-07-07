import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { createOrganization } from "./createOrganization";
import { listLocalOrganizations } from "./listLocalOrganizations";
import { getOrganizationProfileDocumentLocalId } from "./organizationProfile";

function createClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

test("listLocalOrganizations returns one entry per provisioned org with its name", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-test",
  );
  const dbClient = createClient(execSql);

  try {
    const apiClient = {
      createOrganization: respondToOrganizationProvisioning,
    };
    const acme = await createOrganization({
      apiClient,
      dbClient,
      encapsulationKeyPair,
      organizationProfileName: "Acme",
      signingKeyPair,
      userId,
    });
    const globex = await createOrganization({
      apiClient,
      dbClient,
      encapsulationKeyPair,
      organizationProfileName: "Globex",
      signingKeyPair,
      userId,
    });

    const organizations = await listLocalOrganizations({ execSql });

    expect(organizations).toHaveLength(2);
    const byId = new Map(
      organizations.map((organization) => [
        organization.organizationId,
        organization,
      ]),
    );
    expect(byId.get(acme?.organizationId ?? "")?.name).toBe("Acme");
    expect(byId.get(acme?.organizationId ?? "")?.rootContainerId).toBe(
      acme?.rootContainerId,
    );
    expect(byId.get(globex?.organizationId ?? "")?.name).toBe("Globex");
  } finally {
    close();
  }
});

test("listLocalOrganizations resolves a foreign org name from its metadata container when the profile doc is keyed under the server documentId", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-foreign-test",
  );
  const dbClient = createClient(execSql);

  try {
    // Provision an org the normal way; this seeds the Members-granted metadata
    // container and links the organization_profile document under the
    // deterministic local alias `org-profile:<organizationId>`.
    const org = await createOrganization({
      apiClient: { createOrganization: respondToOrganizationProvisioning },
      dbClient,
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      organizationProfileName: "Acme",
      signingKeyPair: generateSigningSeedAndKeyPair(),
      userId: crypto.randomUUID(),
    });
    if (!org) {
      throw new Error("Expected the organization to be created");
    }

    // Rewrite local state to mimic a member of *another* org who received the
    // exact same profile document purely by syncing the metadata container: the
    // sync ingest keys it under the server documentId, and the provisioner-only
    // alias was never written on this device. Re-save the record under its
    // documentId, then drop the alias row so ONLY the cross-org fallback
    // (metadata container by system slot -> linked profile doc) can resolve it.
    const aliasLocalId = getOrganizationProfileDocumentLocalId({
      organizationId: org.organizationId,
    });
    const aliasRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      aliasLocalId,
    );
    if (!aliasRecord?.documentId) {
      throw new Error("Expected a persisted organization profile document");
    }
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...aliasRecord,
      id: aliasRecord.documentId,
    });
    await sqlDocumentsPersistence.deleteDocument(execSql, aliasLocalId);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, aliasLocalId),
    ).toBeNull();

    const organizations = await listLocalOrganizations({ execSql });
    const summary = organizations.find(
      (candidate) => candidate.organizationId === org.organizationId,
    );
    expect(summary?.rootContainerId).toBe(org.rootContainerId);
    expect(summary?.name).toBe("Acme");
  } finally {
    close();
  }
});

test("listLocalOrganizations returns a null name for a foreign org whose profile doc has not synced yet", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-foreign-pending-test",
  );
  const dbClient = createClient(execSql);

  try {
    const org = await createOrganization({
      apiClient: { createOrganization: respondToOrganizationProvisioning },
      dbClient,
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      organizationProfileName: "Acme",
      signingKeyPair: generateSigningSeedAndKeyPair(),
      userId: crypto.randomUUID(),
    });
    if (!org) {
      throw new Error("Expected the organization to be created");
    }

    // Model the window where a foreign org's containers have synced but its
    // profile document has not yet arrived: delete the only profile document.
    // The metadata-container fallback must find nothing to read and degrade to a
    // null (unnamed) org rather than throwing.
    await sqlDocumentsPersistence.deleteDocument(
      execSql,
      getOrganizationProfileDocumentLocalId({
        organizationId: org.organizationId,
      }),
    );

    const organizations = await listLocalOrganizations({ execSql });
    const summary = organizations.find(
      (candidate) => candidate.organizationId === org.organizationId,
    );
    expect(summary?.organizationId).toBe(org.organizationId);
    expect(summary?.name).toBeNull();
  } finally {
    close();
  }
});

test("listLocalOrganizations tolerates a corrupt organization profile", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-corrupt-test",
  );
  const dbClient = createClient(execSql);

  try {
    const created = await createOrganization({
      apiClient: { createOrganization: respondToOrganizationProvisioning },
      dbClient,
      encapsulationKeyPair,
      organizationProfileName: "Acme",
      signingKeyPair,
      userId: crypto.randomUUID(),
    });
    if (!created) {
      throw new Error("Expected the organization to be created");
    }

    const localId = getOrganizationProfileDocumentLocalId({
      organizationId: created.organizationId,
    });
    const record = await sqlDocumentsPersistence.loadDocument(execSql, localId);
    if (!record) {
      throw new Error("Expected the organization profile document");
    }
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...record,
      loroSnapshot: "not-a-valid-loro-snapshot",
    });

    const organizations = await listLocalOrganizations({ execSql });

    expect(organizations).toHaveLength(1);
    expect(organizations[0]?.organizationId).toBe(created.organizationId);
    expect(organizations[0]?.name).toBeNull();
  } finally {
    close();
  }
});

test("listLocalOrganizations is empty when no organizations are persisted", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-empty-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    expect(await listLocalOrganizations({ execSql })).toEqual([]);
  } finally {
    close();
  }
});
