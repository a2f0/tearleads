import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";
import { type CliSession, LoginRefusedError, withSession } from "./session";
import { disabledTracer, type Tracer } from "./trace";

export interface RegisteredAccount {
  /** False when the key's account already existed and nothing was created. */
  readonly created: boolean;
  readonly organizationId: string;
  readonly rootContainerId: string;
  readonly userId: string;
}

interface RegisterInput {
  readonly apiBaseUrl: string;
  readonly recoveryKey: string;
  readonly tracer?: Tracer | undefined;
}

async function readAccount({ sdk, userId }: CliSession) {
  const { organizationId } = sdk.session;
  const { rootContainerId } = sdk.runtime.input().auth;
  if (!organizationId || !rootContainerId) {
    throw new Error("The API did not return the account's organization.");
  }
  return { organizationId, rootContainerId, userId };
}

/**
 * Registers the key's identity with a fresh local root, as a new app install
 * does. Registration answers with a login challenge but issues no session, so
 * nothing here needs revoking.
 */
async function createAccount(input: RegisterInput): Promise<void> {
  const tracer = input.tracer ?? disabledTracer;
  const database = await openLocalDatabase();
  const sdk = new Tearleads({
    apiBaseUrl: input.apiBaseUrl,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    identityProvisioning: "manual",
    logger: {
      log: (message) => tracer.event(`sdk: ${message}`),
      logError: (message) => tracer.event(`sdk error: ${String(message)}`),
    },
  });
  try {
    await tracer.span("derive keys from recovery key", () =>
      sdk.identity.importSeedPhrase(input.recoveryKey),
    );
    await sdk.session.bootstrapLocalRootContainer();
    const registered = await tracer.span("register", () =>
      sdk.session.registerIdentity(),
    );
    if (!registered || "status" in registered) {
      throw new Error("The API did not register this recovery key.");
    }
  } finally {
    sdk.dispose();
    database.close();
  }
}

/**
 * Creates the account a recovery key derives unless the API already knows it,
 * then reads the account back from a signed-in session. Both sign-ins go
 * through `withSession`, which revokes what it opened on every path.
 */
export async function registerAccount(
  input: RegisterInput,
): Promise<RegisteredAccount> {
  try {
    return { created: false, ...(await withSession(input, readAccount)) };
  } catch (error) {
    if (!(error instanceof LoginRefusedError)) throw error;
  }
  await createAccount(input);
  return { created: true, ...(await withSession(input, readAccount)) };
}
