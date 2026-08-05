import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { respondToOrganizationProvisioning } from "../../test/helpers/organizationProvisioningResponder";
import type { ExecSql, ExecSqlClientLike } from "../sqlite";
import { Database } from "./database";
import { createIdentity, type Identity } from "./identity";
import { createSession } from "./session";

function createSqlClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

async function setGeneratedIdentity(identity: Identity) {
  await identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
}

function createHarness(input: {
  execSql: ExecSql;
  databaseId: string;
  onCreateOrganization?: () => Promise<void>;
}) {
  const api = {
    createOrganization: async (
      request: Parameters<ApiClient["createOrganization"]>[0],
    ) => {
      const response = await respondToOrganizationProvisioning(request);
      await input.onCreateOrganization?.();
      return response;
    },
    getAuthToken: () => null,
    setAuthToken: () => undefined,
  } as unknown as ApiClient;
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  const session = createSession({
    api,
    database: new Database({
      client: createSqlClient(input.execSql),
      id: input.databaseId,
    }),
    identity,
    log: () => undefined,
    logError: () => undefined,
    onUserIdentityAvailable: async () => undefined,
  });
  return { identity, session };
}

test("createOrganization returns the provisioned organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-create-organization-test",
  );
  const { identity, session } = createHarness({
    databaseId: "create-organization-test-db",
    execSql,
  });

  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });

    const result = await session.createOrganization();
    expect(result).toEqual({
      containerId: expect.any(String),
      organizationId: expect.any(String),
    });
  } finally {
    close();
  }
});

test("createOrganization discards the result after the identity changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-create-organization-race-test",
  );
  let switchIdentity = async () => undefined;
  const { identity, session } = createHarness({
    databaseId: "create-organization-race-test-db",
    execSql,
    onCreateOrganization: () => switchIdentity(),
  });

  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });
    // The identity is replaced while the provisioning request is in flight;
    // the organization was created under keys that no longer describe the
    // active identity, so the caller must not receive it. Mirrors the
    // registerIdentity transition test.
    switchIdentity = async () => {
      await setGeneratedIdentity(identity);
    };

    await expect(session.createOrganization()).resolves.toBeNull();
  } finally {
    close();
  }
});
