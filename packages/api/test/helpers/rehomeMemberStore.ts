import type { TestUser } from "@tearleads/bob-and-alice";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";

/** A real member store; remote writes stay parked so its queued rename survives. */
export async function createRehomeMemberStore(input: {
  apiBaseUrl: string;
  member: TestUser;
}) {
  const database = await createTestExecSql(`rehome-${crypto.randomUUID()}`);
  const incidents: unknown[] = [];
  const errors: unknown[] = [];
  const sdk = new Tearleads({
    apiBaseUrl: input.apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { execSql: database.execSql, id: "rehome-member" },
    identityProvisioning: "manual",
    logger: {
      log: () => {},
      logError: (message, cause) => errors.push({ message, cause }),
    },
    onSecurityIncident: (incident) => {
      incidents.push(incident);
    },
  });
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: input.member.kem,
    signingKeyPair: input.member.signing,
    signingFingerprint: input.member.fingerprint,
  });
  sdk.session.setContext({
    authToken: input.member.token,
    isAuthenticated: true,
    userId: input.member.userId,
  });
  sdk.syncBillingGate.notifyPaymentRequired(null);
  const store = sdk.containerContents.openTree();
  store.updateRuntime(sdk.containerContents.workflowRuntime());
  const deadline = Date.now() + 10_000;
  while (!store.getSnapshot().ready) {
    if (Date.now() > deadline) {
      sdk.dispose();
      database.close();
      throw new Error("Member store did not initialize");
    }
    await Bun.sleep(10);
  }
  return {
    ...database,
    apiClient: sdk.containerContents.workflowRuntime().apiClient,
    incidents,
    errors,
    store,
    stop: () => sdk.dispose(),
  };
}
