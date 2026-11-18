import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/data/clientTestSupport";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { createExecSql } from "../../data/sqlite/sqlExec";
import { Tearleads } from "../../Tearleads";

test("superseding a login during the pin transaction leaves the next login to establish its own pin", async () => {
  const sqlite = await createTestExecSql("sign-in-pin");
  const inserted = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<void>();
  const authenticate = Promise.withResolvers<void>();
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      const rows = await sqlite.execSql(sql, bind, rowMode ? { rowMode } : {});
      if (
        sql.toLowerCase().includes('insert into "trusted_user_identity_pins"')
      ) {
        inserted.resolve();
        await commit.promise;
      }
      return { rows };
    },
  });
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    database: { execSql, id: "pin" },
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  let verifies = 0;
  const api = Reflect.get(sdk, "apiClient") as ApiClient;
  api.authenticate = async () => {
    if (++verifies > 1) await authenticate.promise;
    return {
      userId: "11111111-1111-4111-8111-111111111111",
      organizationId: "org",
      rootContainerId: null,
      token: "same",
      wsTicket: "ticket",
      authenticated: true,
      isRoot: false,
    };
  };
  try {
    await setGeneratedIdentity(sdk.identity);
    const restore = sdk.session.captureSignIn("restore");
    const old = sdk.session.login();
    expect(restore()).toBe(false);
    expect(sdk.session.captureSignIn("restore")()).toBe(false);
    await inserted.promise;
    const fresh = sdk.session.login();
    commit.resolve();
    await expect(old).resolves.toBe(false);
    expect(
      await execSql("SELECT user_id FROM trusted_user_identity_pins"),
    ).toEqual([]);
    authenticate.resolve();
    await expect(fresh).resolves.toBe(true);
    expect(
      await execSql("SELECT user_id FROM trusted_user_identity_pins"),
    ).toEqual([{ user_id: sdk.session.userId }]);
  } finally {
    commit.resolve();
    authenticate.resolve();
    sdk.dispose();
    sqlite.close();
  }
});

test("removing the host bearer cancels a pending verified renewal", async () => {
  const sqlite = await createTestExecSql("remove-host-bearer");
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    database: { execSql: sqlite.execSql, id: "bearer" },
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const userId = "11111111-1111-4111-8111-111111111111";
  const api = Reflect.get(sdk, "apiClient") as ApiClient;
  api.authenticate = async () => {
    entered.resolve();
    await release.promise;
    return {
      userId,
      organizationId: "org",
      rootContainerId: null,
      token: "renewed",
      wsTicket: "ticket",
      authenticated: true,
      isRoot: false,
    };
  };
  try {
    await setGeneratedIdentity(sdk.identity);
    sdk.session.setContext({ authToken: "old", isAuthenticated: true, userId });
    const previous = sdk.session.captureSignIn();
    const renewal = Reflect.get(sdk.session, "renewExpired")();
    await entered.promise;
    sdk.session.setAuthToken(null);
    release.resolve();
    await expect(renewal).resolves.toBe(false);
    expect(previous()).toBe(false);
    expect(sdk.session.authToken).toBeNull();
    expect(sdk.session.isAuthenticated).toBe(false);
  } finally {
    release.resolve();
    sdk.dispose();
    sqlite.close();
  }
});
