import {
  InMemoryVfsBlobCommitStore,
  InMemoryVfsBlobIsolationStore,
  InMemoryVfsBlobObjectStore,
  InMemoryVfsCrdtSyncServer,
  type InMemoryVfsCrdtSyncServerSnapshot
} from '@tearleads/vfs-sync/vfs';

export class ServerHarness {
  readonly syncServer: InMemoryVfsCrdtSyncServer;
  readonly blobCommitStore: InMemoryVfsBlobCommitStore;
  readonly blobIsolationStore: InMemoryVfsBlobIsolationStore;
  readonly blobObjectStore: InMemoryVfsBlobObjectStore;

  constructor() {
    this.syncServer = new InMemoryVfsCrdtSyncServer();
    this.blobCommitStore = new InMemoryVfsBlobCommitStore();
    this.blobIsolationStore = new InMemoryVfsBlobIsolationStore();
    this.blobObjectStore = new InMemoryVfsBlobObjectStore();
  }

  snapshot(): InMemoryVfsCrdtSyncServerSnapshot {
    return this.syncServer.snapshot();
  }
}
