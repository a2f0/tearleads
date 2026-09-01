import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { respondToOrganizationProvisioning } from "../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { organizationReadModelState } from "../../data/sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { createOrganization } from "./createOrganization";
import { listLocalOrganizations } from "./listLocalOrganizations";
import { getOrganizationProfileDocumentLocalId } from "./organizationProfile";

// Re-key the provisioner-written organization profile document under its
// server documentId, the way the sync ingest stores it on a device that only
// synced it: move the record row AND its durable content (the history
// checkpoint — the only persisted content source) to the new local id, then
// drop the provisioner-only alias row (deleting it also deletes its history).
async function rekeyProfileDocumentToServerId(input: {
  containerId?: string;
  execSql: ExecSql;
  organizationId: string;
}): Promise<{ documentId: string }> {
  const aliasLocalId = getOrganizationProfileDocumentLocalId({
    organizationId: input.organizationId,
  });
  const aliasRecord = await sqlDocumentsPersistence.loadDocument(
    input.execSql,
    aliasLocalId,
  );
  if (!aliasRecord?.documentId) {
    throw new Error("Expected a persisted organization profile document");
  }
  const profileDoc = await loadPersistedDocumentContent({
    execSql: input.execSql,
    localId: aliasLocalId,
    persistence: sqlDocumentsPersistence,
  });
  if (!profileDoc) {
    throw new Error("Expected durable organization profile content");
  }
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    ...aliasRecord,
    ...(input.containerId === undefined
      ? {}
      : { containerId: input.containerId }),
    id: aliasRecord.documentId,
  });
  await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(input.execSql, {
    coveredTailIds: [],
    endVersionVector: encodeVersionVector(profileDoc),
    force: true,
    localId: aliasRecord.documentId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(profileDoc)),
  });
  await sqlDocumentsPersistence.deleteDocument(input.execSql, aliasLocalId);
  return { documentId: aliasRecord.documentId };
}

test("listLocalOrganizations returns one entry per provisioned org with its name", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-test",
  );
  const dbClient = execSqlClientFromExecSql(execSql);

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

test("listLocalOrganizations returns root containers in creation order", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-order-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "custom-root",
        localCreatedAt: "2026-02-01T00:00:00.000Z",
        metadataDocumentId: null,
        name: "/",
        organizationId: "custom-org",
        parentId: null,
        systemSlot: null,
      },
      null,
    );
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "personal-root",
        localCreatedAt: "2026-01-01T00:00:00.000Z",
        metadataDocumentId: null,
        name: "/",
        organizationId: "personal-org",
        parentId: null,
        systemSlot: null,
      },
      null,
    );

    expect(
      (await listLocalOrganizations({ execSql })).map(
        (organization) => organization.organizationId,
      ),
    ).toEqual(["personal-org", "custom-org"]);
  } finally {
    close();
  }
});

test("listLocalOrganizations resolves a foreign org name from its metadata container when the profile doc is keyed under the server documentId", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-foreign-test",
  );
  const dbClient = execSqlClientFromExecSql(execSql);

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
    // alias was never written on this device. Re-key the record and its durable
    // content under the documentId, then drop the alias row so ONLY the
    // cross-org fallback (metadata container by system slot -> linked profile
    // doc) can resolve it.
    await rekeyProfileDocumentToServerId({
      execSql,
      organizationId: org.organizationId,
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(
        execSql,
        getOrganizationProfileDocumentLocalId({
          organizationId: org.organizationId,
        }),
      ),
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

test("listLocalOrganizations resolves an org name from the read model's profile pointer when the synced profile doc is linked outside the metadata container", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-read-model-pointer-test",
  );
  const dbClient = execSqlClientFromExecSql(execSql);

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

    // Model a re-hydrated device whose profile document arrived by sync and is
    // linked to a container other than the organization-metadata one — what the
    // org-manager profile editor produces when it binds the document to the
    // roster-profile container. Neither the provisioner-only alias nor the
    // metadata-container scan can reach it; only the read model's pointer can.
    const { documentId } = await rekeyProfileDocumentToServerId({
      containerId: "some-other-container",
      execSql,
      organizationId: org.organizationId,
    });

    await ensureSqlTables(execSql, organizationReadModelTables);
    await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
      await tx.insert(organizationReadModelState).values({
        organizationId: org.organizationId,
        cursor: "opaque-cursor",
        profileDocumentId: documentId,
        memberGroupId: "members-group",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
    });

    const organizations = await listLocalOrganizations({ execSql });
    const summary = organizations.find(
      (candidate) => candidate.organizationId === org.organizationId,
    );
    expect(summary?.name).toBe("Acme");
  } finally {
    close();
  }
});

test("listLocalOrganizations returns a null name for a foreign org whose profile doc has not synced yet", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-list-local-foreign-pending-test",
  );
  const dbClient = execSqlClientFromExecSql(execSql);

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
  const dbClient = execSqlClientFromExecSql(execSql);

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
    // Content lives only in the durable history: corrupt the checkpoint blob
    // the name lookup restores from.
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: record.snapshotEndVersion,
      force: true,
      localId,
      snapshot: "not-a-valid-loro-snapshot",
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
