import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import type { ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";
import { provisioningSpec } from "./provisioningSpec";

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
    provisionedSystemContainers: provisioningSpec,
  });
}
