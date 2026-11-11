import { expect, test } from "bun:test";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { Tearleads } from "../../Tearleads";
import { createRuntime } from "./workflowRuntime";

async function runtimeFixture() {
  const fixture = await principalIdentityPinFixture(3);
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  sdk.database.configure({ execSql: fixture.execSql, id: "pins" });
  await setGeneratedIdentity(sdk.identity);
  const incidents: unknown[] = [];
  const runtime = createRuntime({
    api: fixture.api,
    blobs: sdk.blobs,
    database: sdk.database,
    documentProjectors: defaultDocumentProjectorRegistry,
    events: sdk.events,
    getDomainScope: () => sdk.domainScope,
    identity: sdk.identity,
    identityTrustDomain: "https://api.example.test",
    log: quietLogger.log,
    logError: quietLogger.logError,
    network: sdk.network,
    reportSecurityIncident: async (error) => {
      incidents.push(error);
    },
    session: sdk.session,
  });
  const verify = () =>
    fixture.verify(runtime.workflowInput().resolveTrustedUserIdentity);
  return {
    ...fixture,
    sdk,
    incidents,
    verify,
    close() {
      sdk.dispose();
      fixture.close();
    },
  };
}

test("runtime preserves the read-only batch capability", async () => {
  const fixture = await runtimeFixture();
  try {
    await fixture.verify();
    fixture.resetCounts();
    await fixture.verify();
    expect(fixture.counts()).toMatchObject({
      transactions: 1,
      pinSelects: 1,
      requests: 0,
      writes: 0,
    });
  } finally {
    fixture.close();
  }
});

for (const change of ["database", "account", "identity", "session"] as const) {
  test(`cached policy refuses runtime ${change} invalidation during pin reads`, async () => {
    const fixture = await runtimeFixture();
    try {
      await fixture.verify();
      fixture.checkpointContext.policies.length = 0;
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      fixture.afterSql(async (sql) => {
        if (
          sql.startsWith("select") &&
          sql.includes("trusted_user_identity_pins")
        ) {
          fixture.afterSql(undefined);
          entered.resolve();
          await resume.promise;
        }
      });
      const result = fixture.verify().catch((error: unknown) => error);
      await entered.promise;
      try {
        if (change === "database") {
          fixture.sdk.database.clear();
          fixture.sdk.database.configure({
            execSql: fixture.execSql,
            id: "pins",
          });
        }
        if (change === "account") {
          fixture.sdk.session.setContext({ userId: crypto.randomUUID() });
          fixture.sdk.session.setContext({ userId: null });
        }
        if (change === "identity")
          await setGeneratedIdentity(fixture.sdk.identity);
        if (change === "session")
          fixture.sdk.session.setAuthToken("refreshed-token");
      } finally {
        resume.resolve();
      }
      expect(await result).toBeInstanceOf(DatabaseUnavailableError);
      expect(fixture.checkpointContext.policies).toEqual([]);
      expect(fixture.incidents).toEqual([]);
      fixture.resetCounts();
      await expect(fixture.verify()).resolves.toHaveLength(1);
      expect(fixture.counts()).toMatchObject({
        pinSelects: 1,
        transactions: 1,
        writes: 0,
      });
    } finally {
      fixture.close();
    }
  });
}
