import {
  type ContainerContentsStore,
  type DocumentStore,
  getOrCreateDomainSyncCoordinator,
  LEGAL_TERMS_VERSION,
  type Tearleads,
} from "@tearleads/client-sdk";
import { type LocalSqlAttribution, openLocalDatabase } from "../localDatabase";
import { createSdkHost } from "../sdkHost";

const SETTLE_TIMEOUT_MS = 120_000;
const POLL_MS = 25;

export type ExportedKeyPackage = Awaited<
  ReturnType<Tearleads["identity"]["exportKeyPackage"]>
>;

type OpenedLocalDb = Awaited<ReturnType<typeof openLocalDatabase>>;

/** Injected seams for unit testing device setup and failure cleanup. */
export interface MultiUserDeviceServices {
  readonly openLocalDatabase?: typeof openLocalDatabase;
  readonly createSdkHost?: typeof createSdkHost;
  readonly waitForIdle?: (
    sdk: Tearleads,
    timeoutMs: number,
  ) => Promise<boolean>;
}

async function waitUntil(
  check: () => Promise<boolean> | boolean,
  what: string,
): Promise<void> {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;
  while (!(await check())) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await Bun.sleep(POLL_MS);
  }
}

/**
 * One installed client in a multi-party in-process performance probe: its own
 * in-memory SQLite database, `Tearleads` SDK instance, and local SQLite
 * attribution hooks.
 */
export class MultiUserDevice {
  private treeStore: ContainerContentsStore | null = null;
  private disposed = false;

  private constructor(
    readonly label: string,
    readonly sdk: Tearleads,
    private readonly localDb: OpenedLocalDb,
    private readonly waitForIdle?: (
      sdk: Tearleads,
      timeoutMs: number,
    ) => Promise<boolean>,
  ) {}

  static async register(
    apiBaseUrl: string,
    identityTrustDomain: string,
    label: string,
    services: MultiUserDeviceServices = {},
  ): Promise<{ device: MultiUserDevice; keyPackage: ExportedKeyPackage }> {
    const device = await MultiUserDevice.open(
      apiBaseUrl,
      identityTrustDomain,
      label,
      services,
    );
    try {
      await device.sdk.identity.generate();
      const registered = await device.sdk.session.registerIdentity({
        acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      });
      if (
        !registered ||
        "status" in registered ||
        !(await device.sdk.session.login(registered.challenge))
      ) {
        throw new Error(`${label} could not register.`);
      }
      const keyPackage = await device.sdk.identity.exportKeyPackage();
      return { device, keyPackage };
    } catch (error) {
      device.dispose();
      throw error;
    }
  }

  static async login(
    apiBaseUrl: string,
    identityTrustDomain: string,
    label: string,
    keyPackage: ExportedKeyPackage,
    services: MultiUserDeviceServices = {},
  ): Promise<MultiUserDevice> {
    const device = await MultiUserDevice.open(
      apiBaseUrl,
      identityTrustDomain,
      label,
      services,
    );
    try {
      await device.sdk.identity.importKeyPackage(keyPackage);
      if (!(await device.sdk.session.login())) {
        throw new Error(`${label} could not log in.`);
      }
      return device;
    } catch (error) {
      device.dispose();
      throw error;
    }
  }

  private static async open(
    apiBaseUrl: string,
    identityTrustDomain: string,
    label: string,
    services: MultiUserDeviceServices = {},
  ): Promise<MultiUserDevice> {
    const openDb = services.openLocalDatabase ?? openLocalDatabase;
    const buildSdk = services.createSdkHost ?? createSdkHost;
    const localDb = await openDb();
    const historyKey = crypto.getRandomValues(new Uint8Array(32));
    try {
      const sdk = buildSdk(
        apiBaseUrl,
        `${label}-${crypto.randomUUID()}`,
        localDb.client,
        {
          identityTrustDomain,
          principalHistoryKeyProvider: async () => historyKey.slice(),
        },
      );
      return new MultiUserDevice(label, sdk, localDb, services.waitForIdle);
    } catch (error) {
      localDb.close();
      throw error;
    }
  }

  get userId(): string {
    const id = this.sdk.session.userId;
    if (!id) throw new Error(`${this.label} has no session.`);
    return id;
  }

  get rootContainerId(): string {
    const id = this.sdk.session.containerId;
    if (!id) throw new Error(`${this.label} has no root container.`);
    return id;
  }

  get organizationId(): string {
    const id = this.sdk.session.organizationId;
    if (!id) throw new Error(`${this.label} has no organization.`);
    return id;
  }

  localSql(): { readonly calls: number; readonly durationMs: number } {
    return { ...this.localDb.measurements };
  }

  captureSqlWindow(): { finish(): LocalSqlAttribution } {
    return this.localDb.captureSqlWindow();
  }

  enterOrganization(organizationId: string): void {
    this.sdk.session.setOrganizationId(organizationId);
    this.treeStore?.updateRuntime(this.sdk.containerContents.workflowRuntime());
  }

  async tree(): Promise<ContainerContentsStore> {
    if (!this.treeStore) {
      const store = this.sdk.containerContents.openTree();
      store.updateRuntime(this.sdk.containerContents.workflowRuntime());
      await waitUntil(() => store.getSnapshot().ready, `${this.label} tree`);
      this.treeStore = store;
    }
    return this.treeStore;
  }

  async holdFolder(folderId: string): Promise<void> {
    const tree = await this.tree();
    const held = () =>
      tree.getSnapshot().nodes.some((node) => node.id === folderId);
    await waitUntil(
      async () => held() || ((await tree.refresh()) && held()),
      `${this.label} folder ${folderId}`,
    );
  }

  async idle(): Promise<void> {
    const settled = this.waitForIdle
      ? await this.waitForIdle(this.sdk, SETTLE_TIMEOUT_MS)
      : await getOrCreateDomainSyncCoordinator(
          this.sdk.domainScope,
        ).waitForIdle({ timeoutMs: SETTLE_TIMEOUT_MS });
    if (!settled) {
      throw new Error(`${this.label} did not settle.`);
    }
  }

  async readDocument(
    documentId: string,
    containerIds: readonly string[],
  ): Promise<DocumentStore | null> {
    const localId =
      await this.sdk.documents.findLocalIdByDocumentId(documentId);
    const held = localId
      ? (await this.sdk.documents.list())?.rows.find(
          (row) => row.id === localId,
        )
      : undefined;
    const found = localId
      ? { containerId: held?.containerId ?? null, localId }
      : await this.discoverDocument(documentId, containerIds);
    if (!found) return null;
    const store = this.sdk.documents.open(
      {
        containerId: found.containerId,
        documentId,
        localId: found.localId,
      },
      { remoteSyncMode: "on-demand" },
    );
    await store
      .requestRemoteSyncAndWait(new AbortController().signal)
      .catch(() => false);
    return store;
  }

  async readDocumentUntilText(
    documentId: string,
    containerIds: readonly string[],
    expectedText: string,
  ): Promise<DocumentStore> {
    const store = await this.readDocument(documentId, containerIds);
    if (!store) {
      throw new Error(`${this.label} could not open document ${documentId}.`);
    }
    await waitUntil(async () => {
      if (store.getSnapshot().text === expectedText) return true;
      await store
        .requestRemoteSyncAndWait(new AbortController().signal)
        .catch(() => false);
      return store.getSnapshot().text === expectedText;
    }, `${this.label} document ${documentId} text`);
    return store;
  }

  private async discoverDocument(
    documentId: string,
    containerIds: readonly string[],
  ): Promise<{ containerId: string; localId: string } | null> {
    const tree = await this.tree();
    await tree.refresh().catch(() => false);
    for (const { id: containerId } of tree.getSnapshot().nodes) {
      if (!containerIds.includes(containerId)) continue;
      const discovered = await this.sdk.containerContents
        .discoverContainerDocuments(containerId)
        .catch(() => null);
      const summary = discovered?.find(
        (candidate) => candidate.documentId === documentId,
      );
      if (summary) return { containerId, localId: summary.id };
    }
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sdk.dispose();
    this.localDb.close();
  }
}
