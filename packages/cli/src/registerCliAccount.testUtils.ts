import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";

/** Registers a fresh account the way an app install does and returns its key. */
export async function registerCliTestAccount(apiBaseUrl: string) {
  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    const { seedPhrase } = await sdk.identity.generate();
    await sdk.session.bootstrapLocalRootContainer();
    const registered = await sdk.session.registerIdentity();
    if (
      !seedPhrase ||
      !registered ||
      "status" in registered ||
      !(await sdk.session.login(registered.challenge))
    ) {
      throw new Error("could not register a test account");
    }
    const userId = sdk.session.userId;
    const organizationId = sdk.session.organizationId;
    const rootContainerId = sdk.session.containerId;
    await sdk.session.logoutRemote();
    return { organizationId, rootContainerId, seedPhrase, userId };
  } finally {
    sdk.dispose();
    database.close();
  }
}
