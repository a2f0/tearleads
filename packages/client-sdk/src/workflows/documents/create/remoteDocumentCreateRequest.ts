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
export interface CreateRemoteDocumentRequest {
  author: DocumentCreateAuthor;
  requireSeededCreate?: boolean | undefined;
  containerId: string;
  containerProjection?: ContainerWriterProjectionResponse | undefined;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  /**
   * The queued row holding the new document's whole content when its first
   * attachment must bind before it: the create does not send it but returns
   * it signed as `deferredSeed`, for that bind to carry.
   */
  deferredSeedUpdate?: PendingUpdateRecord | undefined;
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
  /**
   * The queued row holding the new document's whole content (see
   * `documentCreateSeedCandidate`). The create commits it as its seed, and the
   * caller settles the row from the response instead of syncing it.
   */
  seedUpdate?: PendingUpdateRecord | undefined;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

/** One create call's request joined with the service's collaborators. */
export interface RemoteDocumentCreateInput extends CreateRemoteDocumentRequest {
  apiClient: DocumentCreateApi;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  targetSecretKey: Uint8Array;
}
