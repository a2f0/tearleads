import {
  InMemoryVfsCrdtSyncServer,
  type InMemoryVfsCrdtSyncServerSnapshot
} from '@tearleads/vfs-sync/vfs';

export class ServerHarness {
  readonly syncServer: InMemoryVfsCrdtSyncServer;

  constructor() {
    this.syncServer = new InMemoryVfsCrdtSyncServer();
  }

  snapshot(): InMemoryVfsCrdtSyncServerSnapshot {
    return this.syncServer.snapshot();
  }
}
