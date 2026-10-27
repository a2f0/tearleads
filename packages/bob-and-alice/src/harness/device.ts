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
import { until } from "./until";

export type DeviceKeys = Parameters<Tearleads["identity"]["setKeyPairs"]>[0];

type DeviceDatabase = Awaited<ReturnType<typeof createTestExecSql>>;

/** One `logError` report from the SDK. */
export interface LoggedError {
  readonly message: string | Error;
  readonly cause: unknown;
}

/**
 * One installed client: its own SQLite database and a full `Tearleads`
 * runtime. Nothing here reaches past the SDK's public surface, so a device
 * can only do and see what a real host could.
 */
export class Device {
  private treeStore: ContainerContentsStore | null = null;

  private constructor(
    readonly label: string,
    readonly sdk: Tearleads,
    private readonly database: DeviceDatabase,
    /** `logError` reports; an honest run should leave this empty. */
    readonly errors: readonly LoggedError[],
    /** Trust-boundary failures; an honest API must never cause one. */
    readonly incidents: readonly unknown[],
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

  private static async open(origin: string, label: string, keys: DeviceKeys) {
    const database = await createTestExecSql(`${label}-${crypto.randomUUID()}`);
    const errors: LoggedError[] = [];
    const incidents: unknown[] = [];
    const sdk = new Tearleads({
      apiBaseUrl: origin,
      blobStore: createMemoryBlobStore(),
      database: {
        id: `${label}-${crypto.randomUUID()}`,
        client: {
          async exec({ sql, bind, rowMode }) {
            return {
              rows: await database.execSql(
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
        logError: (message, cause) => errors.push({ message, cause }),
      },
      onSecurityIncident: (incident) => {
        incidents.push(incident);
      },
      online: true,
    });
    await sdk.identity.setKeyPairs(keys);
    return new Device(label, sdk, database, errors, incidents);
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
    this.sdk.dispose();
    this.database.close();
  }
}
