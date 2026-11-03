import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";

export interface CliSession {
  /**
   * Throws when, so far in this command, the SDK logged an error or an API
   * request failed or got no response: a listing read then may be partial.
   */
  assertNoFailures(): void;
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

function describeLoggedError(message: string | Error, cause: unknown): string {
  const text = message instanceof Error ? message.message : message;
  return cause instanceof Error ? `${text}: ${cause.message}` : text;
}

function failedRequests(sdk: Tearleads): string[] {
  const snapshot = sdk.apiRequests.getSnapshot(sdk.identity.signingFingerprint);
  return snapshot.endpoints
    .filter((endpoint) => endpoint.failed > 0)
    .map(
      (endpoint) =>
        `${endpoint.method} ${endpoint.path} failed ${endpoint.failed} time(s)`,
    );
}

async function revoke(sdk: Tearleads): Promise<boolean> {
  try {
    return await sdk.session.logoutRemote();
  } catch {
    return false;
  }
}

/**
 * Signs in as the identity derived from `recoveryKey`, runs `work`, then
 * revokes the session and discards the in-memory database. A session that
 * cannot be revoked fails the command, unless `work` already failed.
 */
export async function withSession<T>(
  apiBaseUrl: string,
  recoveryKey: string,
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  const database = await openLocalDatabase();
  const loggedErrors: string[] = [];
  const sdk = new Tearleads({
    apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: {
      log: () => undefined,
      logError: (message, cause) => {
        loggedErrors.push(describeLoggedError(message, cause));
      },
    },
  });
  const assertNoFailures = () => {
    const problems = [...loggedErrors, ...failedRequests(sdk)];
    if (problems.length > 0) {
      throw new Error(
        `The API did not answer completely, so the result may be partial:\n  ${problems.join("\n  ")}`,
      );
    }
  };

  let signedIn = false;
  try {
    await sdk.identity.importSeedPhrase(recoveryKey);
    signedIn = await sdk.session.login();
    const userId = sdk.session.userId;
    if (!signedIn || !userId) {
      throw new LoginRefusedError();
    }
    const result = await work({ assertNoFailures, sdk, userId });
    signedIn = false;
    if (!(await revoke(sdk))) {
      throw new Error(
        "Could not revoke this command's session on the API; it stays valid until it expires.",
      );
    }
    return result;
  } finally {
    if (signedIn) await revoke(sdk);
    sdk.dispose();
    database.close();
  }
}
