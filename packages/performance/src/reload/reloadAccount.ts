import {
  ApiRequestMetrics,
  getOrCreateDomainSyncCoordinator,
  LEGAL_TERMS_VERSION,
  type SessionContext,
  type Tearleads,
} from "@tearleads/client-sdk";
import type { ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";
import { openLocalDatabase } from "../localDatabase";
import { createSdkHost } from "../sdkHost";
import { type RequestCount, requestCounts } from "./requestCounts";
import { requestTotals, settle } from "./settle";

/** Folders or notes created between waits for queued writes to settle. */
const CREATE_BATCH = 25;
const SETTLE_TIMEOUT_MS = 300_000;
const POLL_MS = 25;

export interface ReloadOutcome {
  /**
   * From building the SDK until the probe last saw a request start, run or
   * finish. It looks 25 ms after each time the sync coordinator is idle.
   */
  readonly settledMs: number;
  readonly requests: number;
  readonly byRoute: readonly RequestCount[];
}

/** The browser profile a reload keeps: its database and keyring. */
interface Profile {
  readonly origin: string;
  readonly databaseId: string;
  readonly client: ExecSqlClientLike;
  /** The app derives this from its local keyring; it survives a reload. */
  readonly historyKey: Uint8Array;
}

function openSdk(profile: Profile) {
  const metrics = new ApiRequestMetrics();
  const sdk = createSdkHost(
    profile.origin,
    profile.databaseId,
    profile.client,
    {
      apiRequestMetrics: metrics,
      // Stored principal history stays trusted across launches only under the
      // same key. A fresh copy per call: the SDK clears the key it is given.
      principalHistoryKeyProvider: async () => profile.historyKey.slice(),
    },
  );
  return { sdk, metrics };
}

async function waitUntil(check: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;
  while (!check()) {
    if (performance.now() >= deadline)
      throw new Error(`Timed out waiting for ${what}.`);
    await Bun.sleep(POLL_MS);
  }
}

async function idle(
  sdk: Tearleads,
  timeoutMs = SETTLE_TIMEOUT_MS,
): Promise<void> {
  const coordinator = getOrCreateDomainSyncCoordinator(sdk.domainScope);
  if (!(await coordinator.waitForIdle({ timeoutMs })))
    throw new Error("Queued writes did not settle.");
}

/**
 * Waits for every create in a batch, then fails with the first failure, so
 * none is still writing when the account closes.
 */
async function allSettled<T>(work: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(work);
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

/** What the app restores from its own storage on a page load. */
interface Restored {
  readonly rootId: string;
  readonly keyPackage: Awaited<
    ReturnType<Tearleads["identity"]["exportKeyPackage"]>
  >;
  readonly session: SessionContext;
}

async function register(profile: Profile, local: { close(): void }) {
  const opened = openSdk(profile);
  const { sdk } = opened;
  try {
    await sdk.identity.generate();
    // The operator running the probe agrees to the terms for its accounts.
    const account = await sdk.session.registerIdentity({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
    });
    if (!account || "status" in account)
      throw new Error("Registration failed.");
    if (!(await sdk.session.login(account.challenge)))
      throw new Error("Login failed.");
    const { containerStore, view } = sdk.deviceFirst.open();
    view.updateRuntime(sdk.containerContents.workflowRuntime());
    await waitUntil(() => containerStore.getSnapshot().ready, "the tree");
    const signedIn = sdk.session.snapshot;
    if (!signedIn.containerId) throw new Error("The session has no root.");
    const restored: Restored = {
      rootId: signedIn.containerId,
      keyPackage: await sdk.identity.exportKeyPackage(),
      session: {
        authToken: signedIn.authToken,
        containerId: signedIn.containerId,
        defaultOrganizationId: signedIn.defaultOrganizationId,
        isAuthenticated: true,
        organizationId: signedIn.organizationId,
        rootAcknowledgments: signedIn.rootAcknowledgments,
        userId: signedIn.userId,
      },
    };
    return { opened, restored };
  } catch (error) {
    sdk.dispose();
    local.close();
    throw error;
  }
}

/** Waits until the SDK is idle and its requests have gone quiet. */
function quiet(
  { sdk, metrics }: ReturnType<typeof openSdk>,
  quietMs: number,
  started = performance.now(),
) {
  const totals = () =>
    requestTotals(metrics.getSnapshot, [null, sdk.identity.signingFingerprint]);
  return {
    totals,
    settled: settle({
      started,
      quietMs,
      timeoutMs: SETTLE_TIMEOUT_MS,
      idle: (remainingMs) => idle(sdk, remainingMs),
      totals,
    }),
  };
}

/**
 * The app's startup over an existing database, until it settles. `started`
 * is when the SDK was built.
 */
async function start(
  opened: ReturnType<typeof openSdk>,
  restored: Restored,
  quietMs: number,
  started: number,
): Promise<ReloadOutcome> {
  const { sdk } = opened;
  await sdk.identity.importKeyPackage(restored.keyPackage);
  sdk.session.setContext(restored.session);
  const { view } = sdk.deviceFirst.open();
  view.updateRuntime(sdk.containerContents.workflowRuntime());
  // The explorer shows the root after a reload.
  view.setActiveContainer(restored.rootId);
  // The interest acknowledgement starts the HTTP catch-up. The runtime
  // copies the connection state, so the view is bound again, as the app
  // binds it again when it renders the new state.
  sdk.events.setConnected(true);
  view.updateRuntime(sdk.containerContents.workflowRuntime());
  const { totals, settled } = quiet(opened, quietMs, started);
  const settledMs = await settled;
  const { total, endpoints } = totals();
  return {
    settledMs: Math.round(settledMs),
    requests: total,
    byRoute: requestCounts(endpoints),
  };
}

/** Creates folders under the root, as the explorer does, until there are `count`. */
async function createFolders(
  sdk: Tearleads,
  rootId: string,
  folders: string[],
  count: number,
): Promise<void> {
  const tree = sdk.deviceFirst.open().containerStore;
  while (folders.length < count) {
    const first = folders.length;
    const batch = Math.min(CREATE_BATCH, count - first);
    const created = await allSettled(
      Array.from({ length: batch }, (_, offset) =>
        tree.createChild(rootId, `Folder ${first + offset + 1}`),
      ),
    );
    for (const folder of created) {
      if (!folder) throw new Error("Folder creation failed.");
      folders.push(folder.id);
    }
    await idle(sdk);
  }
}

/** Creates one note as the app does, and syncs it. */
async function createNote(
  sdk: Tearleads,
  containerId: string,
  position: number,
): Promise<void> {
  const note = sdk.containerContents.documentLinks().openDocument({
    containerId,
    localId: crypto.randomUUID(),
    initialText: `Note ${position + 1}`,
  });
  if (
    !(await note.ensureInitialized()) ||
    !(await note.requestRemoteSyncAndWait())
  )
    throw new Error(`Note ${position + 1} did not sync.`);
}

/**
 * One registered account whose local database outlives each SDK instance,
 * as a browser profile outlives a page. A reload disposes the SDK and builds
 * a new one over the same database, then restores the identity and session
 * the app would restore from its own storage.
 */
export async function openReloadAccount(origin: string, quietMs: number) {
  const local = await openLocalDatabase();
  const profile: Profile = {
    origin,
    databaseId: crypto.randomUUID(),
    client: local.client,
    historyKey: crypto.getRandomValues(new Uint8Array(32)),
  };
  const registered = await register(profile, local);
  const { restored } = registered;
  // The running SDK; null between disposing one and building the next.
  let running: ReturnType<typeof openSdk> | null = registered.opened;
  const folders: string[] = [];
  let documents = 0;
  const current = () => {
    if (!running) throw new Error("No SDK is running.");
    return running;
  };

  return {
    folders: () => folders.length,
    /** Local SQLite statements so far, across every SDK instance. */
    localSql: () => ({ ...local.measurements }),
    /**
     * Creates notes as the app does, `perFolder` to a folder under the root,
     * until the account holds `count`.
     */
    async grow(count: number, perFolder: number): Promise<void> {
      const { sdk } = current();
      await createFolders(
        sdk,
        restored.rootId,
        folders,
        Math.ceil(count / perFolder),
      );
      while (documents < count) {
        const first = documents;
        const batch = Math.min(CREATE_BATCH, count - first);
        await allSettled(
          Array.from({ length: batch }, async (_, offset) => {
            const position = first + offset;
            const folder = folders[Math.floor(position / perFolder)];
            if (!folder) throw new Error("The note's folder is missing.");
            await createNote(sdk, folder, position);
          }),
        );
        documents += batch;
        await idle(sdk);
      }
      // Nothing the creates started may spill into the next reload's counts.
      await quiet(current(), quietMs).settled;
    },
    /** Disposes the running SDK and starts a new one, as a page load does. */
    async reload(): Promise<ReloadOutcome> {
      current().sdk.dispose();
      running = null;
      const started = performance.now();
      const opened = openSdk(profile);
      // Held before startup, so a failed reload's SDK is the one `close` disposes.
      running = opened;
      return await start(opened, restored, quietMs, started);
    },
    close(): void {
      running?.sdk.dispose();
      running = null;
      local.close();
    },
  };
}

export type ReloadAccount = Awaited<ReturnType<typeof openReloadAccount>>;
