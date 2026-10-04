import type { ApiClient } from "@tearleads/api-client";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  createContainerContentsStore,
  createContainerContentsStoreWorkflowRuntime,
  createDomainScope,
  createMemoryBlobStore,
  defaultDocumentProjectorRegistry,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { trustedResolver } from "./coldSdkRematerialization";

/** A real member store; remote writes stay parked so its queued rename survives. */
export async function createRehomeMemberStore(input: {
  apiClient: ApiClient;
  member: TestUser;
  owner: TestUser;
}) {
  const database = await createTestExecSql(`rehome-${crypto.randomUUID()}`);
  const incidents: unknown[] = [];
  const errors: unknown[] = [];
  const runtime = createContainerContentsStoreWorkflowRuntime(
    {
      apiClient: input.apiClient,
      auth: {
        isAuthenticated: true,
        organizationId: null,
        rootContainerId: null,
        userId: input.member.userId,
      },
      crypto: {
        encapsulationKeyPair: input.member.kem,
        signingKeyPair: input.member.signing,
        signingFingerprint: input.member.fingerprint,
      },
      infra: {
        blobStore: createMemoryBlobStore(),
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql: database.execSql,
      },
      resolveTrustedUserIdentity: trustedResolver(input.owner, input.member),
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        isRemoteSyncBlocked: () => true,
        log: () => {},
        logError: (message, cause) => errors.push({ message, cause }),
        reportSecurityIncident: async (incident) => {
          incidents.push(incident);
        },
      },
    },
    () => false,
  );
  const store = createContainerContentsStore(runtime);
  store.updateRuntime(runtime);
  const deadline = Date.now() + 10_000;
  while (!store.getSnapshot().ready) {
    if (Date.now() > deadline)
      throw new Error("Member store did not initialize");
    await Bun.sleep(10);
  }
  return {
    ...database,
    incidents,
    errors,
    store,
    stop: () =>
      store.updateRuntime({
        ...runtime,
        infra: { ...runtime.infra, dbStatus: "terminated" },
      }),
  };
}
