import {
  type ContainerContentsStore,
  createMemoryBlobStore,
  getOrCreateDomainSyncCoordinator,
  Tearleads,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { DeviceTransport } from "./transport";
import { until } from "./until";

export type DeviceKeys = Parameters<Tearleads["identity"]["setKeyPairs"]>[0];

type DeviceDatabase = Awaited<ReturnType<typeof createTestExecSql>>;

/** One `logError` report from the SDK. */
export interface LoggedError {
  readonly message: string | Error;
  readonly cause: unknown;
}

interface DeviceStorage {
  readonly database: DeviceDatabase;
  readonly databaseId: string;
  readonly blobStore: ReturnType<typeof createMemoryBlobStore>;
  readonly transport: DeviceTransport;
  readonly errors: LoggedError[];
  readonly incidents: unknown[];
}

/**
 * One installed client: its own SQLite database and a full `Tearleads`
 * runtime. Nothing here reaches past the SDK's public surface, so a device
 * can only do and see what a real host could.
 */
export class Device {
  private treeStore: ContainerContentsStore | null = null;
  private retired = false;

  private constructor(
    readonly label: string,
    readonly sdk: Tearleads,
    private readonly storage: DeviceStorage,
    private readonly origin: string,
    private readonly keys: DeviceKeys,
  ) {}

  static async register(origin: string, label: string) {
    const keys: DeviceKeys = {
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: generateSigningSeedAndKeyPair(),
    };
    const device = await Device.open(origin, label, keys);
    await device.sdk.session.bootstrapLocalRootContainer();
    const registered = await device.sdk.session.registerIdentity();
    if (
      !registered ||
      "status" in registered ||
      !(await device.sdk.session.login(registered.challenge))
    ) {
      throw new Error(`${label} could not register`);
    }
    return { device, keys };
  }

  /** A fresh install of an existing identity: same keys, empty database. */
  static async login(origin: string, label: string, keys: DeviceKeys) {
    const device = await Device.open(origin, label, keys);
    if (!(await device.sdk.session.login())) {
      throw new Error(`${label} could not log in`);
    }
    return device;
  }

  private static async open(
    origin: string,
    label: string,
    keys: DeviceKeys,
    existing?: DeviceStorage,
    online = true,
  ) {
    const storage: DeviceStorage = existing ?? {
      database: await createTestExecSql(`${label}-${crypto.randomUUID()}`),
      databaseId: `${label}-${crypto.randomUUID()}`,
      blobStore: createMemoryBlobStore(),
      transport: new DeviceTransport(origin),
      errors: [],
      incidents: [],
    };
    const sdk = new Tearleads({
      apiBaseUrl: storage.transport.origin,
      identityTrustDomain: origin,
      blobStore: storage.blobStore,
      database: {
        id: storage.databaseId,
        client: {
          async exec({ sql, bind, rowMode }) {
            return {
              rows: await storage.database.execSql(
                sql,
                bind,
                rowMode ? { rowMode } : undefined,
              ),
            };
          },
        },
      },
      logger: {
        log: () => undefined,
        logError: (message, cause) => storage.errors.push({ message, cause }),
      },
      onSecurityIncident: (incident) => {
        storage.incidents.push(incident);
      },
      online,
    });
    if (!online) sdk.network.setMode("offline");
    try {
      await sdk.identity.setKeyPairs(keys);
    } catch (error) {
      sdk.dispose();
      if (!existing) {
        storage.transport.dispose();
        storage.database.close();
      }
      throw error;
    }
    return new Device(label, sdk, storage, origin, keys);
  }

  get transport(): DeviceTransport {
    return this.storage.transport;
  }
  get errors(): readonly LoggedError[] {
    return this.storage.errors;
  }
  get incidents(): readonly unknown[] {
    return this.storage.incidents;
  }

  /** Reopens the runtime with the same SQLite database, blobs, keys, and pins. */
  async restart(online = true): Promise<Device> {
    if (this.retired) throw new Error(`${this.label} is already retired`);
    const organizationId = this.organizationId;
    this.sdk.dispose();
    this.retired = true;
    let next: Device | undefined;
    try {
      next = await Device.open(
        this.origin,
        this.label,
        this.keys,
        this.storage,
        online,
      );
      if (!(await next.sdk.session.login())) {
        throw new Error(`${this.label} could not log in after restart`);
      }
      next.enterOrganization(organizationId);
      return next;
    } catch (error) {
      // Ownership transfers only after login; a failed restart closes storage.
      next?.sdk.dispose();
      this.storage.transport.dispose();
      this.storage.database.close();
      throw error;
    }
  }

  get userId(): string {
    const userId = this.sdk.session.userId;
    if (!userId) throw new Error(`${this.label} has no session`);
    return userId;
  }

  get rootContainerId(): string {
    const containerId = this.sdk.session.containerId;
    if (!containerId) throw new Error(`${this.label} has no root container`);
    return containerId;
  }

  get organizationId(): string {
    const organizationId = this.sdk.session.organizationId;
    if (!organizationId) throw new Error(`${this.label} has no organization`);
    return organizationId;
  }

  /** Works inside `organizationId`, as a member switching to it would. */
  enterOrganization(organizationId: string): void {
    this.sdk.session.setOrganizationId(organizationId);
    this.treeStore?.updateRuntime(this.sdk.containerContents.workflowRuntime());
  }

  async tree(): Promise<ContainerContentsStore> {
    if (!this.treeStore) {
      const store = this.sdk.containerContents.openTree();
      store.updateRuntime(this.sdk.containerContents.workflowRuntime());
      await until(() => store.getSnapshot().ready, `${this.label} tree`);
      this.treeStore = store;
    }
    return this.treeStore;
  }

  /**
   * Waits until this install's tree holds `folderId`, as a user must see a
   * folder before acting on it; a fresh install pulls it from the API.
   */
  async holdFolder(folderId: string): Promise<void> {
    const tree = await this.tree();
    const held = () =>
      tree.getSnapshot().nodes.some((node) => node.id === folderId);
    await until(
      async () => held() || ((await tree.refresh()) && held()),
      `${this.label} folder ${folderId}`,
    );
  }

  /** Simulates the host's network mode and updates its held tree runtime. */
  setOnline(online: boolean): void {
    this.sdk.network.setMode(online ? "online" : "offline");
    this.treeStore?.updateRuntime(this.sdk.containerContents.workflowRuntime());
  }

  /** Waits until every queued local write has settled with the API. */
  async idle(): Promise<void> {
    const coordinator = getOrCreateDomainSyncCoordinator(
      this.sdk.runtime.input().state.domainScope,
    );
    if (!(await coordinator.waitForIdle({ timeoutMs: 20_000 }))) {
      throw new Error(`${this.label} did not settle`);
    }
  }

  /** An error naming `what` failed, with what this device logged meanwhile. */
  failure(what: string): Error {
    const logged = this.errors.map(({ message, cause }) =>
      cause === undefined
        ? String(message)
        : `${String(message)}: ${String(cause)}`,
    );
    const detail = logged.length ? ` (logged: ${logged.join(" | ")})` : "";
    return new Error(`${this.label}: ${what}${detail}`);
  }

  dispose(): void {
    if (this.retired) return;
    this.retired = true;
    this.sdk.dispose();
    this.storage.transport.dispose();
    this.storage.database.close();
  }
}
