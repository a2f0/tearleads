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

function createSqlClient(
  execSql: ExecSql,
  onExec?: () => void,
): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      onExec?.();
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
  onExec?: () => void;
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
      client: createSqlClient(input.execSql, input.onExec),
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
  let switched = false;
  let switchIdentity = async () => undefined;
  let persistenceWritesAfterSwitch = 0;
  const { identity, session } = createHarness({
    databaseId: "create-organization-race-test-db",
    execSql,
    onCreateOrganization: () => switchIdentity(),
    onExec: () => {
      if (switched) {
        persistenceWritesAfterSwitch += 1;
      }
    },
  });

  try {
    await setGeneratedIdentity(identity);
    session.setContext({ userId: crypto.randomUUID() });
    // The identity is replaced while the provisioning request is in flight.
    // The organization was created under keys that no longer describe the
    // active identity, so the caller must not receive it — and the workflow
    // must not run local persistence, whose captured database client an
    // identity switch closes or renews. Mirrors the registerIdentity
    // transition test.
    switchIdentity = async () => {
      await setGeneratedIdentity(identity);
      switched = true;
    };

    await expect(session.createOrganization()).resolves.toBeNull();
    expect(persistenceWritesAfterSwitch).toBe(0);
  } finally {
    close();
  }
});
