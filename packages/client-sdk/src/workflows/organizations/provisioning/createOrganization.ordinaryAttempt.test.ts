import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { respondToOrganizationProvisioning } from "../../../../test/helpers/organizationProvisioningResponder";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import {
  createExecSql,
  type ExecSqlClientLike,
  type SqlArrayRow,
  type SqlRow,
} from "../../../data/sqlite/sqlSchema";
import { createInitializedContainerMetadataDocument } from "../../container-contents/metadata/containerMetadataDocument";
import { createOrganization } from "./createOrganization";

function identity() {
  return {
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
    userId: crypto.randomUUID(),
  };
}

async function openConnection(
  dbName: string,
  failCompletion: () => boolean = () => false,
) {
  const db = await initTestSqliteDatabase({
    dbName,
    cipher: "chacha20",
    key: "ordinary-retry",
  });
  const dbClient: ExecSqlClientLike = {
    exec: async (options) => {
      if (
        failCompletion() &&
        options.sql.startsWith(
          'delete from "organization_provisioning_attempts"',
        )
      ) {
        throw new Error("completion write failed");
      }
      return {
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      };
    },
  };
  return {
    dbClient,
    execSql: createExecSql(dbClient),
    close: () => db.close(),
  };
}

test("ordinary retry survives closing SQLite and rolls back an unsuccessful completion", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  let failCompletion = false;
  let connection = await openConnection(dbName, () => failCompletion);
  const creator = identity();
  const requests: CreateOrganizationRequest[] = [];
  const apiClient = {
    createOrganization: async (request: CreateOrganizationRequest) => {
      requests.push(request);
      const response = await respondToOrganizationProvisioning(request);
      if (requests.length === 1) throw new Error("committed response lost");
      return response;
    },
  };
  const create = () =>
    createOrganization({
      ...creator,
      apiClient,
      dbClient: connection.dbClient,
      organizationProfileName: "Reopened",
      logError: () => {},
    });
  try {
    await expect(create()).rejects.toThrow("committed response lost");
    const first = requests[0];
    if (!first) throw new Error("Expected initial create");
    connection.close();
    connection = await openConnection(dbName, () => failCompletion);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([{ organization_id: first.organizationId }]);
    failCompletion = true;
    await expect(create()).rejects.toThrow(
      'delete from "organization_provisioning_attempts"',
    );
    expect(
      await sqlContainerContentsPersistence.containerExists(
        connection.execSql,
        first.rootContainerId,
      ),
    ).toBe(false);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([{ organization_id: first.organizationId }]);
    failCompletion = false;
    const response = await create();
    expect(response?.organizationId).toBe(first.organizationId);
    expect(requests).toEqual([first, first, first]);
    expect(
      await sqlContainerContentsPersistence.containerExists(
        connection.execSql,
        first.rootContainerId,
      ),
    ).toBe(true);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test("concurrent ordinary calls adopt one intent and both complete bootstrap", async () => {
  const connection = await openConnection(`/${crypto.randomUUID()}.db`);
  const creator = identity();
  const requests: CreateOrganizationRequest[] = [];
  let releaseRequests = () => {};
  const bothSubmitted = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  const receipts = new Map<
    string,
    ReturnType<typeof respondToOrganizationProvisioning>
  >();
  const input = {
    ...creator,
    dbClient: connection.dbClient,
    apiClient: {
      createOrganization: async (request: CreateOrganizationRequest) => {
        requests.push(request);
        const receipt =
          receipts.get(request.organizationId) ??
          respondToOrganizationProvisioning(request);
        receipts.set(request.organizationId, receipt);
        if (requests.length === 2) releaseRequests();
        // Neither call can finish bootstrap before both have loaded the intent.
        await bothSubmitted;
        return receipt;
      },
    },
  };
  try {
    const responses = await Promise.all([
      createOrganization(input),
      createOrganization(input),
    ]);
    const first = requests[0];
    if (!first) throw new Error("Expected concurrent create requests");
    expect(requests).toEqual([first, first]);
    expect(responses[0]?.organizationId).toBe(first.organizationId);
    expect(responses).toEqual([responses[0], responses[0]]);
    expect(receipts.size).toBe(1);
    expect(
      await connection.execSql(
        "SELECT DISTINCT organization_id FROM containers",
      ),
    ).toEqual([{ organization_id: first.organizationId }]);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    releaseRequests();
    connection.close();
  }
});

test("pending ordinary attempts are scoped by the whole creation intent and user", async () => {
  const connection = await openConnection(`/${crypto.randomUUID()}.db`);
  const creator = identity();
  const requests: CreateOrganizationRequest[] = [];
  const apiClient = {
    createOrganization: async (request: CreateOrganizationRequest) => {
      requests.push(request);
      return null;
    },
  };
  const input = {
    ...creator,
    apiClient,
    dbClient: connection.dbClient,
    organizationProfileName: "Same name",
  };
  try {
    await createOrganization(input);
    await createOrganization({
      ...input,
      rosterProfileNickname: "Different nickname",
    });
    await createOrganization({ ...input, userId: crypto.randomUUID() });
    await createOrganization(input);
    expect(requests[3]).toEqual(requests[0]);
    expect(
      new Set(requests.map((request) => request.organizationId)).size,
    ).toBe(3);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toHaveLength(3);
  } finally {
    connection.close();
  }
});

test("acknowledgement binds an unprovisioned device-first root", async () => {
  const connection = await openConnection(`/${crypto.randomUUID()}.db`);
  try {
    const response = await createOrganization({
      ...identity(),
      dbClient: connection.dbClient,
      apiClient: {
        createOrganization: async (request: CreateOrganizationRequest) => {
          await sqlContainerContentsPersistence.ensureSchema(
            connection.execSql,
          );
          await sqlContainerContentsPersistence.saveContainer(
            connection.execSql,
            {
              id: request.rootContainerId,
              organizationId: "",
              parentId: null,
              metadataDocumentId: null,
              name: "/",
              icon: null,
              effectiveAccessLevel: "admin",
            },
            null,
          );
          return respondToOrganizationProvisioning(request);
        },
      },
    });
    if (!response) throw new Error("Expected acknowledged creation");
    const root =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        connection.execSql,
        response.rootContainerId,
      );
    expect(root?.container).toMatchObject({
      organizationId: response.organizationId,
      metadataDocumentId: response.rootMetadataDocumentId,
    });
    expect(root?.record?.documentId).toBe(response.rootMetadataDocumentId);
  } finally {
    connection.close();
  }
});

test("ordinary adoption preserves later metadata and fills only missing bootstrap state", async () => {
  const connection = await openConnection(`/${crypto.randomUUID()}.db`);
  const requests: CreateOrganizationRequest[] = [];
  const input = {
    ...identity(),
    dbClient: connection.dbClient,
    apiClient: {
      createOrganization: async (request: CreateOrganizationRequest) => {
        requests.push(request);
        return requests.length === 1
          ? null
          : respondToOrganizationProvisioning(request);
      },
    },
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
  };
  try {
    expect(await createOrganization(input)).toBeNull();
    const first = requests[0];
    if (!first) throw new Error("expected initial request");
    const response = await respondToOrganizationProvisioning(first);
    const system = response.systemContainers[0];
    if (!system) throw new Error("expected system container");
    const existingContainers = [
      {
        id: response.rootContainerId,
        documentId: response.rootMetadataDocumentId,
      },
      {
        id: system.container.containerId,
        documentId: system.metadataDocument.id,
      },
    ];
    await sqlContainerContentsPersistence.ensureSchema(connection.execSql);
    for (const existing of existingContainers) {
      const metadata = await createInitializedContainerMetadataDocument(
        existing.id,
        { name: "Later synced name", icon: "star" },
      );
      await sqlContainerContentsPersistence.saveContainer(
        connection.execSql,
        {
          id: existing.id,
          organizationId: response.organizationId,
          parentId: null,
          metadataDocumentId: existing.documentId,
          name: "Later synced name",
          icon: "star",
          effectiveAccessLevel: "read",
        },
        {
          id: existing.id,
          documentId: existing.documentId,
          accessEpoch: 1,
          lastCommitLsn: "42",
          metadataUpdates: bytesToBase64(metadata.initialUpdate),
          snapshotEndVersion: "",
        },
        {
          localUpdatedAt: "2026-11-10T00:00:00.000Z",
          serverTimestamps: { updatedAt: "2026-11-10T00:00:00.000Z" },
        },
      );
    }
    const roster = response.rosterProfileContainer;
    if (!roster) throw new Error("expected roster container");
    // Discovery may have only the structural row, not its metadata. Preserve
    // that row's access/timestamps while installing the missing genesis body.
    await sqlContainerContentsPersistence.saveContainer(
      connection.execSql,
      {
        id: roster.container.containerId,
        organizationId: response.organizationId,
        parentId: response.rootContainerId,
        metadataDocumentId: roster.metadataDocument.id,
        name: "Discovered roster",
        icon: null,
        effectiveAccessLevel: "read",
      },
      null,
    );
    const before = await sqlContainerContentsPersistence.loadContainers(
      connection.execSql,
    );
    expect(before).toHaveLength(3);
    expect(await createOrganization(input)).toEqual(response);
    expect(requests).toEqual([first, first]);
    for (const existing of before.filter((state) => state.record)) {
      const after =
        await sqlContainerContentsPersistence.loadContainerMetadataState(
          connection.execSql,
          existing.container.id,
        );
      expect(after?.record).toEqual(existing.record);
      expect(after?.container).toEqual(existing.container);
    }
    const rosterAfter =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        connection.execSql,
        roster.container.containerId,
      );
    expect(rosterAfter?.container).toEqual(
      before.find(
        (state) => state.container.id === roster.container.containerId,
      )?.container,
    );
    expect(rosterAfter?.record?.metadataUpdates.length).toBeGreaterThan(0);
    expect(
      await sqlContainerContentsPersistence.containerExists(
        connection.execSql,
        response.organizationMetadataContainer.container.containerId,
      ),
    ).toBe(true);
    expect(
      await connection.execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toEqual([]);
  } finally {
    connection.close();
  }
});
