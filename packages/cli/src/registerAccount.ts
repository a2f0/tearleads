import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";
import { disabledTracer, type Tracer } from "./trace";

export interface RegisteredAccount {
  /** False when the key's account already existed and nothing was created. */
  readonly created: boolean;
  readonly organizationId: string;
  readonly rootContainerId: string;
  readonly userId: string;
}

function signedInAccount(sdk: Tearleads, created: boolean): RegisteredAccount {
  const { organizationId, userId } = sdk.session;
  const { rootContainerId } = sdk.runtime.input().auth;
  if (!organizationId || !rootContainerId || !userId) {
    throw new Error("The API did not return the account's organization.");
  }
  return { created, organizationId, rootContainerId, userId };
}

/**
 * Registers the account a recovery key derives, the way an app install does:
 * a fresh local root becomes the account's root on the API. A key whose
 * account already exists only signs in, so running it again changes nothing.
 * Either way the session it opened is revoked before it returns.
 */
export async function registerAccount(input: {
  readonly apiBaseUrl: string;
  readonly recoveryKey: string;
  readonly tracer?: Tracer | undefined;
}): Promise<RegisteredAccount> {
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
    let account: RegisteredAccount;
    if (await tracer.span("sign in", () => sdk.session.login())) {
      account = signedInAccount(sdk, false);
    } else {
      await sdk.session.bootstrapLocalRootContainer();
      const registered = await tracer.span("register", () =>
        sdk.session.registerIdentity(),
      );
      if (
        !registered ||
        "status" in registered ||
        !(await tracer.span("sign in", () =>
          sdk.session.login(registered.challenge),
        ))
      ) {
        throw new Error("The API did not register this recovery key.");
      }
      account = signedInAccount(sdk, true);
    }
    if (
      !(await tracer.span("revoke session", () => sdk.session.logoutRemote()))
    )
      throw new Error(
        "Could not revoke this command's session on the API; it stays valid until it expires.",
      );
    return account;
  } finally {
    sdk.dispose();
    database.close();
  }
}
