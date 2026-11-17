import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { DocumentContainerProjectionRepository } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { errorMessage } from "../../../data/shared/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../data/shared/securityIncidents";
import { isDatabaseUnavailableError } from "../../../data/sync/databaseUnavailable";
import {
  type DocumentLinkSetFailureHandler,
  type LinkSetAttachmentReuse,
  type RelinkRemoteDocumentResult,
  RemoteDocumentService,
  type RemoteDocumentServiceApi,
  resolveDocumentCreateAuthor,
} from "../../documents";
import type { SubtreePurgeRoot } from "../../documents/purge/subtreePurgeScope";
import type { PrincipalPolicyOperation } from "../../principals/principalPolicyService";
import type { ContainerContentsWorkflowRuntime } from "../runtime";

export type ContainerDocumentLinkApi = RemoteDocumentServiceApi;
type ContainerDocumentLinkOperation = Parameters<
  RemoteDocumentService["relinkRemoteDocument"]
>[0]["operation"];
type RemoteDocumentPersistedState =
  RelinkRemoteDocumentResult["persistedState"];

export interface ContainerDocumentLinkRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "principalPolicies"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerDocumentLinkApi;
}

export type { RemoteDocumentPersistedState };

/**
 * Hand a link/unlink/move/purge failure to host diagnostics as a real `Error`.
 * The caller's string-only log line stays the fallback for a host without
 * `logError`, so this never logs a second copy of the same failure.
 */
function reportDocumentLinkMutationFailure(
  util: ContainerDocumentLinkRuntime["util"],
  error: unknown,
): void {
  // `ApiClient` returns `RequestFailure` objects instead of throwing, so
  // offline and 403/404/409 already left through the `!result` branch: a status
  // filter here would be dead code. Only a database lost mid-flight stays quiet.
  if (!util.logError || isDatabaseUnavailableError(error)) return;
  try {
    // A host logger that throws or rejects must not replace the null result or
    // skip the failure handler below.
    void Promise.resolve(
      util.logError("Container contents: document link mutation failed", error),
    ).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

export async function relinkRemoteContainerDocument(input: {
  attachmentReuse?: LinkSetAttachmentReuse | undefined;
  beforeSubmit?: (() => Promise<boolean>) | undefined;
  documentId: string;
  expectedSubtreeRoot?: SubtreePurgeRoot | undefined;
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: ContainerDocumentLinkOperation;
  /** A workflow root's token; each leg otherwise discovers on its own. */
  policyOperation?: PrincipalPolicyOperation | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot?: Uint8Array | undefined;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  const {
    documentId,
    noteId,
    operation,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
  const author = resolveDocumentCreateAuthor(runtime);
  const targetSecretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  const execSql = runtime.infra.execSql;
  if (input.isCurrent?.() === false) return null;
  if (!author || !targetSecretKey) {
    runtime.util.log(
      "Container contents: document mutation skipped because the local key context is unavailable",
    );
    input.onFailure?.({
      message: "the local key context is unavailable",
      status: null,
    });
    return null;
  }
  const remoteDocuments = new RemoteDocumentService({
    api: runtime.apiClient,
    encapsulationSecretKey: targetSecretKey,
    execSql,
  });

  try {
    const result = await remoteDocuments.relinkRemoteDocument({
      attachmentReuse: input.attachmentReuse,
      beforeSubmit: input.beforeSubmit,
      author,
      documentId,
      expectedSubtreeRoot: input.expectedSubtreeRoot,
      onFailure: input.onFailure,
      operation,
      resolveProjectionUserKey,
      rotationSnapshot: input.rotationSnapshot,
      stillCurrent: input.isCurrent,
      targetContainerId,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer({
        operation: input.policyOperation,
      }),
    });
    if (!result) {
      runtime.util.log(
        `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
      );
      return null;
    }
    if (input.isCurrent?.() === false) return null;

    await new DocumentContainerProjectionRepository(
      execSql,
    ).replaceDocumentLinks(documentId, result.linkedContainerIds, {
      stillCurrent: input.isCurrent,
    });

    return result;
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(
      error,
      runtime.util.reportSecurityIncident,
      {
        objectId: documentId,
        objectKind: "document",
        operation: `document.${operation}`,
      },
    );
    const message = errorMessage(error);
    runtime.util.log(
      `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${message}`,
    );
    // After the keying rethrow above, so a verification failure keeps its
    // security incident instead of being reported twice, and before the failure
    // handler, so a throwing caller callback cannot swallow the report.
    reportDocumentLinkMutationFailure(runtime.util, error);
    input.onFailure?.({ message, status: null });
    return null;
  }
}

export async function unlinkRemoteContainerDocument(input: {
  attachmentReuse?: LinkSetAttachmentReuse | undefined;
  beforeSubmit?: (() => Promise<boolean>) | undefined;
  documentId: string;
  expectedSubtreeRoot?: SubtreePurgeRoot | undefined;
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  policyOperation?: PrincipalPolicyOperation | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot: Uint8Array;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteContainerDocument({
    ...input,
    operation: "unlink",
  });
}
