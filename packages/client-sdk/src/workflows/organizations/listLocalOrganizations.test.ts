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
