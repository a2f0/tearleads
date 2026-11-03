import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";

export interface CliSession {
  readonly sdk: Tearleads;
  readonly userId: string;
}

/** Thrown when the API refuses to sign in the identity behind a key. */
class LoginRefusedError extends Error {
  constructor() {
    super(
      "The API refused to sign in with this recovery key. Check that the account exists on this target.",
    );
    this.name = "LoginRefusedError";
  }
}

/**
 * Signs in as the identity derived from `recoveryKey`, runs `work`, then
 * revokes the session and discards the in-memory database, whatever `work`
 * does.
 */
export async function withSession<T>(
  apiBaseUrl: string,
  recoveryKey: string,
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: { log: () => undefined, logError: () => undefined },
  });
  let signedIn = false;
  try {
    await sdk.identity.importSeedPhrase(recoveryKey);
    signedIn = await sdk.session.login();
    const userId = sdk.session.userId;
    if (!signedIn || !userId) {
      throw new LoginRefusedError();
    }
    return await work({ sdk, userId });
  } finally {
    if (signedIn) {
      await sdk.session.logoutRemote().catch(() => false);
    }
    sdk.dispose();
    database.close();
  }
}
