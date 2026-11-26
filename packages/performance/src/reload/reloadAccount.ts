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

/** Folders or notes created between waits for queued writes to settle. */
const CREATE_BATCH = 25;
const SETTLE_TIMEOUT_MS = 300_000;
const POLL_MS = 25;

export interface ReloadOutcome {
  /** From building the SDK until its last request finished. */
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

async function idle(sdk: Tearleads): Promise<void> {
  const coordinator = getOrCreateDomainSyncCoordinator(sdk.domainScope);
  if (!(await coordinator.waitForIdle({ timeoutMs: SETTLE_TIMEOUT_MS })))
    throw new Error("Queued writes did not settle.");
}

/** Requests under every identity scope the SDK counted them under. */
function requestTotals(sdk: Tearleads, metrics: ApiRequestMetrics) {
  const scopes = new Set([null, sdk.identity.signingFingerprint]);
  const snapshots = [...scopes].map((scope) => metrics.getSnapshot(scope));
  return {
    total: snapshots.reduce((sum, snapshot) => sum + snapshot.total, 0),
    inFlight: snapshots.reduce((sum, snapshot) => sum + snapshot.inFlight, 0),
    endpoints: snapshots.flatMap((snapshot) => snapshot.endpoints),
  };
}

/**
 * Waits until the SDK's queued work is idle and no request has started or
 * finished for `quietMs`, and returns when its last request finished. Some
 * catch-up work re-arms itself on timers the coordinator does not track, so
 * idle alone does not show that a reload has finished.
 */
async function settle(
  sdk: Tearleads,
  metrics: ApiRequestMetrics,
  quietMs: number,
): Promise<number> {
  const started = performance.now();
  let seen = requestTotals(sdk, metrics).total;
  let lastChange = started;
  let lastRequest = started;
  for (;;) {
    await idle(sdk);
    await Bun.sleep(POLL_MS);
    const now = performance.now();
    if (now - started > SETTLE_TIMEOUT_MS)
      throw new Error("The reload did not settle.");
    const { total, inFlight } = requestTotals(sdk, metrics);
    if (total !== seen || inFlight > 0) {
      seen = total;
      lastChange = now;
      lastRequest = now;
    } else if (now - lastChange >= quietMs) {
      return lastRequest - started;
    }
  }
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
  const { sdk } = openSdk(profile);
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
    return { sdk, restored };
  } catch (error) {
    sdk.dispose();
    local.close();
    throw error;
  }
}

/** The app's startup over an existing database, until it settles. */
async function start(profile: Profile, restored: Restored, quietMs: number) {
  const { sdk, metrics } = openSdk(profile);
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
  const settledMs = await settle(sdk, metrics, quietMs);
  const { total, endpoints } = requestTotals(sdk, metrics);
  const outcome: ReloadOutcome = {
    settledMs: Math.round(settledMs),
    requests: total,
    byRoute: requestCounts(endpoints),
  };
  return { sdk, outcome };
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
    const created = await Promise.all(
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
  let { sdk } = registered;
  const folders: string[] = [];
  let documents = 0;

  return {
    folders: () => folders.length,
    /** Local SQLite statements so far, across every SDK instance. */
    localSql: () => ({ ...local.measurements }),
    /**
     * Creates notes as the app does, `perFolder` to a folder under the root,
     * until the account holds `count`.
     */
    async grow(count: number, perFolder: number): Promise<void> {
      await createFolders(
        sdk,
        restored.rootId,
        folders,
        Math.ceil(count / perFolder),
      );
      while (documents < count) {
        const first = documents;
        const batch = Math.min(CREATE_BATCH, count - first);
        await Promise.all(
          Array.from({ length: batch }, (_, offset) => {
            const position = first + offset;
            const folder = folders[Math.floor(position / perFolder)];
            if (!folder) throw new Error("The note's folder is missing.");
            return createNote(sdk, folder, position);
          }),
        );
        documents += batch;
        await idle(sdk);
      }
    },
    /** Disposes the running SDK and starts a new one, as a page load does. */
    async reload(): Promise<ReloadOutcome> {
      sdk.dispose();
      const started = await start(profile, restored, quietMs);
      sdk = started.sdk;
      return started.outcome;
    },
    close(): void {
      sdk.dispose();
      local.close();
    },
  };
}

export type ReloadAccount = Awaited<ReturnType<typeof openReloadAccount>>;
