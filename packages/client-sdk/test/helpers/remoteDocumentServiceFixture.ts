import type { SyncRemoteDocumentResult } from "../../src/data/documents/shared/sync/documentSyncTypes";
import type { CreateRemoteDocumentResult } from "../../src/data/documents/shared/types";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import type { RemoteDocumentCreateInput } from "../../src/workflows/documents/create/remoteDocumentCreateRequest";
import type { RemoteDocumentServiceApi } from "../../src/workflows/documents/remote/remoteDocumentCollaborators";
import { RemoteDocumentService } from "../../src/workflows/documents/remote/remoteDocumentService";
import type { RemoteDocumentSyncPass } from "../../src/workflows/documents/sync/remoteDocumentSyncPass";

/**
 * A service over a fake that implements only the API calls its test path
 * makes; a call it lacks fails as a TypeError, as it did when each workflow
 * took its own API slice. The fake is passed as is, so its `this` binding and
 * identity stay those of the object the test built.
 */
export function createRemoteDocumentServiceFixture(input: {
  readonly api: Partial<RemoteDocumentServiceApi>;
  readonly encapsulationSecretKey?: Uint8Array | null | undefined;
  readonly execSql: ExecSql;
  readonly isRemoteSyncBlocked?:
    | ((organizationId: string) => boolean)
    | undefined;
}): RemoteDocumentService {
  return new RemoteDocumentService({
    api: input.api as RemoteDocumentServiceApi,
    encapsulationSecretKey: input.encapsulationSecretKey ?? null,
    execSql: input.execSql,
    isRemoteSyncBlocked: input.isRemoteSyncBlocked,
  });
}

/** Syncs through a fixture service built from the pass's collaborator fields. */
export function syncRemoteDocumentForTest({
  apiClient,
  execSql,
  isRemoteSyncBlocked,
  targetSecretKey,
  ...request
}: RemoteDocumentSyncPass): Promise<SyncRemoteDocumentResult | null> {
  return createRemoteDocumentServiceFixture({
    api: apiClient,
    encapsulationSecretKey: targetSecretKey,
    execSql,
    isRemoteSyncBlocked,
  }).syncRemoteDocument(request);
}

/** Creates through a fixture service built from the input's collaborator fields. */
export function createRemoteDocumentForTest({
  apiClient,
  execSql,
  isRemoteSyncBlocked,
  targetSecretKey,
  ...request
}: RemoteDocumentCreateInput): Promise<CreateRemoteDocumentResult | null> {
  return createRemoteDocumentServiceFixture({
    api: apiClient,
    encapsulationSecretKey: targetSecretKey,
    execSql,
    isRemoteSyncBlocked,
  }).createRemoteDocument(request);
}
