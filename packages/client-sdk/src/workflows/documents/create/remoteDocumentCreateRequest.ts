import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type {
  DocumentCreateApi,
  DocumentCreateAuthor,
} from "../../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentCreateTerminalFailureHandler } from "./createProjectionFetch";

/** What one `RemoteDocumentService.createRemoteDocument` call varies. */
interface DocumentCreateOptions {
  author: DocumentCreateAuthor;
  onRecoveredStaleTarget?: (() => void) | undefined;
  containerId: string;
  containerProjection?: ContainerWriterProjectionResponse | undefined;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId?: string | undefined;
  eventId?: string | undefined;
  expectedOrganizationId?: string | undefined;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  /**
   * Invoked when the create submission fails terminally (not a benign
   * adopt/stale-target conflict) — e.g. the server denies the write. Callers
   * persist the failure so the write queue can surface it.
   */
  onTerminalSubmitFailure?: DocumentCreateTerminalFailureHandler | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

/** Existing ordinary create options, including a queued birth or a deferred attachment birth. */
export interface CreateRemoteDocumentRequest extends DocumentCreateOptions {
  requireSeededCreate?: false | undefined;
  seedUpdate?: PendingUpdateRecord | undefined;
  deferredSeedUpdate?: PendingUpdateRecord | undefined;
}

export type DocumentSubmissionRequest =
  | CreateRemoteDocumentRequest
  | (DocumentCreateOptions & {
      requireSeededCreate: true;
      seedUpdate: PendingUpdateRecord;
      deferredSeedUpdate?: undefined;
    });

/** One create call's request joined with the service's collaborators. */
export type RemoteDocumentCreateInput = DocumentSubmissionRequest & {
  apiClient: DocumentCreateApi;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  targetSecretKey: Uint8Array;
};
