import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
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
