import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import type { ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";

export function createSdkHost(
  origin: string,
  id: string,
  client: ExecSqlClientLike,
) {
  return new Tearleads({
    apiBaseUrl: origin,
    database: { client, id },
    blobStoreFactory: () => createMemoryBlobStore(),
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
    // Same public host input as the app. Contacts are created after login
    // by the app and deliberately outside this registration scenario.
    provisionedSystemContainers: [
      {
        name: "Trash",
        icon: "trash",
        slotDefinition: {
          namespace: "tearleads.explorer",
          projectorId: "explorer",
          slotId: "trash",
          version: 1,
        },
      },
    ],
  });
}
