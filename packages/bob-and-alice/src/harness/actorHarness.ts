import { randomUUID } from 'node:crypto';
import type { Database } from '@tearleads/db/sqlite';
import {
  createTestDatabase,
  type TestDatabaseContext,
  TestKeyManager,
  type WithRealDatabaseOptions
} from '@tearleads/db-test-utils';
import { LocalWriteOrchestrator } from '@tearleads/local-write-orchestrator';
import {
  InMemoryVfsCrdtFeedReplayStore,
  InMemoryVfsCrdtSyncTransport,
  type QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClient,
  type VfsBackgroundSyncClientFlushResult,
  type VfsBackgroundSyncClientSnapshot,
  type VfsBackgroundSyncClientSyncResult,
  type VfsCrdtOperation
} from '@tearleads/vfs-sync/vfs';
import type { ServerHarness } from './serverHarness.js';

export interface ActorHarnessConfig {
  alias: string;
  userId?: string;
  clientId?: string;
  server: ServerHarness;
  databaseOptions?: WithRealDatabaseOptions;
  now?: () => Date;
}

export class ActorHarness {
  readonly alias: string;
  readonly userId: string;
  readonly clientId: string;

  private readonly server: ServerHarness;
  private readonly transport: InMemoryVfsCrdtSyncTransport;
  readonly syncClient: VfsBackgroundSyncClient;
  readonly feedReplayStore: InMemoryVfsCrdtFeedReplayStore;
  readonly writeOrchestrator: LocalWriteOrchestrator;
  readonly keyManager: TestKeyManager;

  private dbContext: TestDatabaseContext | null = null;

  private constructor(config: ActorHarnessConfig) {
    this.alias = config.alias;
    this.userId = config.userId ?? randomUUID();
    this.clientId = config.clientId ?? `client-${config.alias}`;
    this.server = config.server;

    this.transport = new InMemoryVfsCrdtSyncTransport(this.server.syncServer);

    const syncOptions = config.now ? { now: config.now } : {};
    this.syncClient = new VfsBackgroundSyncClient(
      this.userId,
      this.clientId,
      this.transport,
      syncOptions
    );

    this.feedReplayStore = new InMemoryVfsCrdtFeedReplayStore();
    this.writeOrchestrator = new LocalWriteOrchestrator();
    this.keyManager = new TestKeyManager();
    this.keyManager.setIsSetUp(true);
  }

  static async create(config: ActorHarnessConfig): Promise<ActorHarness> {
    const actor = new ActorHarness(config);
    actor.dbContext = await createTestDatabase(config.databaseOptions);
    return actor;
  }

  get db(): Database {
    if (!this.dbContext) {
      throw new Error(`Actor "${this.alias}" database not initialized`);
    }
    return this.dbContext.db;
  }

  get adapter(): TestDatabaseContext['adapter'] {
    if (!this.dbContext) {
      throw new Error(`Actor "${this.alias}" database not initialized`);
    }
    return this.dbContext.adapter;
  }

  queueCrdtOp(input: QueueVfsCrdtLocalOperationInput): VfsCrdtOperation {
    return this.syncClient.queueLocalOperation(input);
  }

  async flush(): Promise<VfsBackgroundSyncClientFlushResult> {
    return this.syncClient.flush();
  }

  async sync(): Promise<VfsBackgroundSyncClientSyncResult> {
    return this.syncClient.sync();
  }

  syncSnapshot(): VfsBackgroundSyncClientSnapshot {
    return this.syncClient.snapshot();
  }

  async close(): Promise<void> {
    await this.writeOrchestrator.drain();
    if (this.dbContext) {
      await this.dbContext.adapter.close();
      this.dbContext = null;
    }
  }
}
