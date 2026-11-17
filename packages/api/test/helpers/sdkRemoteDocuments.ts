import {
  type CreateRemoteDocumentRequest,
  type CreateRemoteDocumentResult,
  RemoteDocumentService,
  type RemoteDocumentServiceApi,
  type SyncRemoteDocumentRequest,
  type SyncRemoteDocumentResult,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";

/** The collaborators an SDK fixture keeps beside each of its requests. */
export interface SdkRemoteDocumentCollaborators {
  readonly apiClient: RemoteDocumentServiceApi;
  readonly execSql: ExecSql;
  readonly isRemoteSyncBlocked?:
    | ((organizationId: string) => boolean)
    | undefined;
  readonly targetSecretKey: Uint8Array;
}

function remoteDocumentService(
  input: SdkRemoteDocumentCollaborators,
): RemoteDocumentService {
  return new RemoteDocumentService({
    api: input.apiClient,
    encapsulationSecretKey: input.targetSecretKey,
    execSql: input.execSql,
    isRemoteSyncBlocked: input.isRemoteSyncBlocked,
  });
}

/** Syncs through a service bound to the fixture's collaborators. */
export function syncSdkRemoteDocument({
  apiClient,
  execSql,
  isRemoteSyncBlocked,
  targetSecretKey,
  ...request
}: SdkRemoteDocumentCollaborators &
  SyncRemoteDocumentRequest): Promise<SyncRemoteDocumentResult | null> {
  return remoteDocumentService({
    apiClient,
    execSql,
    isRemoteSyncBlocked,
    targetSecretKey,
  }).syncRemoteDocument(request);
}

/** Creates through a service bound to the fixture's collaborators. */
export function createSdkRemoteDocument({
  apiClient,
  execSql,
  isRemoteSyncBlocked,
  targetSecretKey,
  ...request
}: SdkRemoteDocumentCollaborators &
  CreateRemoteDocumentRequest): Promise<CreateRemoteDocumentResult | null> {
  return remoteDocumentService({
    apiClient,
    execSql,
    isRemoteSyncBlocked,
    targetSecretKey,
  }).createRemoteDocument(request);
}
