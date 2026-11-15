import type { Documents, DocumentsRuntime } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";

/** The documents authority profile-document work resolves under. Runtime
 * notifications that leave it unchanged (realtime events, network or
 * sync-mode changes) must not discard ready profile work and the unblurred
 * draft its editor holds. */
export interface ProfileDocumentScope {
  readonly documents: Documents;
  readonly runtime: DocumentsRuntime;
}

/** Whether two documents runtime snapshots share one profile authority. */
export function sameProfileDocumentsScope(
  left: DocumentsRuntime,
  right: DocumentsRuntime,
): boolean {
  return (
    left.state.domainScope === right.state.domainScope &&
    left.infra.execSql === right.infra.execSql &&
    left.infra.dbStatus === right.infra.dbStatus &&
    left.auth.userId === right.auth.userId &&
    left.auth.organizationId === right.auth.organizationId &&
    left.auth.isAuthenticated === right.auth.isAuthenticated &&
    left.crypto.signingFingerprint === right.crypto.signingFingerprint &&
    left.crypto.signingKeyPair === right.crypto.signingKeyPair &&
    left.crypto.encapsulationKeyPair === right.crypto.encapsulationKeyPair
  );
}

/** Keeps its identity across non-scope runtime notifications and yields a new
 * object on every scope change, so A -> B -> A still invalidates. */
export function useProfileDocumentScope(): ProfileDocumentScope {
  const tearleads = useTearleads();
  const { documents } = tearleads;
  const runtime = useRuntimeScopedMemo(
    () => documents.workflowRuntime(),
    [documents],
  );
  const { domainScope } = runtime.state;
  const { dbStatus, execSql } = runtime.infra;
  const { isAuthenticated, organizationId, userId } = runtime.auth;
  const { encapsulationKeyPair, signingFingerprint, signingKeyPair } =
    runtime.crypto;
  // The snapshot itself rotates on every notification; only its scope fields
  // key the memo, which captures the snapshot current at that render.
  return useMemo(
    () => ({ documents, runtime: documents.workflowRuntime() }),
    [
      dbStatus,
      documents,
      domainScope,
      encapsulationKeyPair,
      execSql,
      isAuthenticated,
      organizationId,
      signingFingerprint,
      signingKeyPair,
      userId,
    ],
  );
}

/** Whether async work keyed on `scope` may still publish its result. */
export function isProfileDocumentScopeCurrent(
  scope: ProfileDocumentScope,
): boolean {
  return sameProfileDocumentsScope(
    scope.runtime,
    scope.documents.workflowRuntime(),
  );
}
