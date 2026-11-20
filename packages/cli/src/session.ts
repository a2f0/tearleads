import { format } from "node:util";
import {
  createMemoryBlobStore,
  type DocumentProjectorDefinition,
  Tearleads,
} from "@tearleads/client-sdk";
import { isOpfsInstallWarning, openLocalDatabase } from "./localDatabase";
import { TracingApiRequestMetrics } from "./sdkTracing";
import { disabledTracer, type Tracer } from "./trace";

export interface CliSession {
  /**
   * Throws when, so far in this command, the SDK logged an error or an API
   * request failed or got no response: a listing read then may be partial.
   */
  assertNoFailures(): void;
  recordExpectedSeedFailure(
    reason: "missing head" | "verified purge" | "recovered stale target",
  ): void;
  readonly sdk: Tearleads;
  readonly tracer: Tracer;
  readonly userId: string;
}

export interface SessionOptions {
  readonly documentProjectors?:
    | readonly DocumentProjectorDefinition[]
    | undefined;
  readonly registerShutdown?:
    | ((revoke: () => Promise<boolean>) => void)
    | undefined;
  readonly apiBaseUrl: string;
  readonly verificationDeadline?: AbortSignal | undefined;
  readonly recoveryKey: string;
  readonly tracer?: Tracer | undefined;
}

const CONSOLE_METHODS = ["debug", "error", "info", "log", "warn"] as const;

/**
 * While tracing, labels anything a dependency prints through `console` with
 * its method, so stray output shows where it came from. Returns the restore.
 */
function labelConsoleOutput(tracer: Tracer): () => void {
  if (!tracer.enabled) return () => undefined;
  const originals = CONSOLE_METHODS.map(
    (method) => [method, console[method]] as const,
  );
  for (const method of CONSOLE_METHODS) {
    console[method] = (...args: unknown[]) => {
      if (method === "warn" && isOpfsInstallWarning(args)) return;
      tracer.event(`console.${method}: ${format(...args)}`);
    };
  }
  return () => {
    for (const [method, original] of originals) console[method] = original;
  };
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

function failedRequests(
  sdk: Tearleads,
  missingHeads: number,
  expectedCreateFailures: number,
): string[] {
  const snapshot = sdk.apiRequests.getSnapshot(sdk.identity.signingFingerprint);
  return snapshot.endpoints
    .map((endpoint) => {
      // Count only typed absences, verified purges, and successful stale-target retries.
      const allowed =
        endpoint.method === "GET" &&
        endpoint.path === "/documents/{documentId}/writer-projection"
          ? missingHeads
          : endpoint.method === "POST" && endpoint.path === "/documents"
            ? expectedCreateFailures
            : 0;
      return { ...endpoint, failed: endpoint.failed - allowed };
    })
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
  options: SessionOptions,
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  const tracer = options.tracer ?? disabledTracer;
  const restoreConsole = labelConsoleOutput(tracer);
  try {
    return await runSession({ ...options, tracer }, work);
  } finally {
    restoreConsole();
  }
}

async function runSession<T>(
  {
    apiBaseUrl,
    recoveryKey,
    tracer,
    documentProjectors,
    registerShutdown,
    verificationDeadline,
  }: SessionOptions & { tracer: Tracer },
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  const database = await tracer.span("open local database", () =>
    openLocalDatabase(),
  );
  const loggedErrors: string[] = [];
  const sdk = new Tearleads({
    apiBaseUrl,
    apiRequestMetrics: new TracingApiRequestMetrics(tracer),
    streamingDownloads: true,
    verificationDeadline,
    blobStoreFactory: () => createMemoryBlobStore(),
    database: { client: database.client, id: crypto.randomUUID() },
    documentProjectors,
    identityProvisioning: "manual",
    logger: {
      log: (message) => tracer.event(`sdk: ${message}`),
      logError: (message, cause) => {
        const described = describeLoggedError(message, cause);
        loggedErrors.push(described);
        tracer.event(`sdk error: ${described}`);
      },
    },
  });
  let missingHeads = 0;
  let expectedCreateFailures = 0;
  const recordExpectedSeedFailure: CliSession["recordExpectedSeedFailure"] = (
    reason,
  ) => {
    if (reason === "missing head") missingHeads++;
    else expectedCreateFailures++;
  };
  const assertNoFailures = () => {
    const problems = [
      ...loggedErrors,
      ...failedRequests(sdk, missingHeads, expectedCreateFailures),
    ];
    if (problems.length > 0) {
      throw new Error(
        `The API did not answer completely, so the result may be partial:\n  ${problems.join("\n  ")}`,
      );
    }
  };

  const loginResult = Promise.withResolvers<boolean>();
  let revocation: Promise<boolean> | undefined;
  const revokeOnce = () => {
    revocation ??= loginResult.promise.then((active) => !active || revoke(sdk));
    return revocation;
  };
  registerShutdown?.(revokeOnce);
  let signedIn = false;
  try {
    await tracer.span("derive keys from recovery key", () =>
      sdk.identity.importSeedPhrase(recoveryKey),
    );
    signedIn = await tracer.span("sign in", () => sdk.session.login());
    loginResult.resolve(signedIn);
    if (revocation) throw new Error("Command interrupted.");
    const userId = sdk.session.userId;
    if (!signedIn || !userId) {
      throw new LoginRefusedError();
    }
    const result = await work({
      assertNoFailures,
      recordExpectedSeedFailure,
      sdk,
      tracer,
      userId,
    });
    signedIn = false;
    if (!(await tracer.span("revoke session", revokeOnce))) {
      throw new Error(
        "Could not revoke this command's session on the API; it stays valid until it expires.",
      );
    }
    return result;
  } finally {
    loginResult.resolve(false);
    if (signedIn) await revokeOnce();
    sdk.dispose();
    database.close();
  }
}
