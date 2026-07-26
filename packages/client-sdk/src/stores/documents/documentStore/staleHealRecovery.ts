import {
  encodeVersionVector,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  classifyHealBlockedReason,
  createDocumentWriterPublicKeyResolver,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
  traceHistoryRecovered,
  traceHistoryRecoveryFailed,
  traceHistoryRecoveryStart,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { importPendingUpdates, installRebuiltDocument } from "./historyRebuild";
import { chainIdentityWrite } from "./identityWriteChain";
import { createStoredDocument } from "./initialization";
import {
  enqueuePendingUpdate,
  listPendingUpdates,
  pendingDeltaSinceBase,
} from "./persistence";
import type { DocumentStoreState } from "./state";
import {
  documentSyncContextMatches,
  importSyncedDocumentUpdates,
} from "./syncUpdateImport";

/**
 * Last-resort recovery for a stale-bundle heal blocked on a shallow local
 * document: the heal needs a full-history rotation baseline, but shallow
 * persistence discarded the op log. The projection now serves the superseded
 * container KEK epochs to members who spanned the rotation, so the remote op
 * log is decryptable again — pull ALL of it read-only, replay it into a fresh
 * document (op identity intact), install that, and let the next sync pass run
 * the heal with the full history it was missing.
 *
 * Bounded per store lifetime so a pull that cannot actually restore the heal
 * (e.g. this member never had access to the rotated-away epochs) degrades
 * back to the descriptive blocked-heal failure instead of looping.
 */

const MAX_HISTORY_RECOVERY_ATTEMPTS = 2;

export function isStaleHealSnapshotUnavailableError(error: unknown): boolean {
  return classifyHealBlockedReason(error) === "snapshot-unavailable";
}

type HistoryRecoveryOutcome =
  | { readonly kind: "recovered"; readonly updates: number }
  | { readonly kind: "doc-changed" }
  | { readonly kind: "install-failed" }
  | { readonly kind: "pull-failed" };

async function pullFullRemoteHistory(
  state: DocumentStoreState,
  currentRecord: NonNullable<DocumentStoreState["record"]>,
): Promise<Awaited<ReturnType<typeof syncRemoteDocument>>> {
  const author = resolveDocumentCreateAuthor(state.runtime);
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  const documentId = currentRecord.documentId;
  if (
    !author ||
    !encapsulationKeyPair ||
    !documentId ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    return null;
  }

  return syncRemoteDocument({
    apiClient: state.runtime.apiClient,
    author,
    documentId,
    execSql: state.runtime.infra.execSql,
    isRemoteSyncBlocked: state.runtime.util.isRemoteSyncBlocked,
    // The rebuilt document must carry the complete op log, so pull from the
    // empty frontier rather than the local (shallow) version.
    localVersionVector: null,
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    onSyncTrace: (line) => state.runtime.util.log(`Documents: ${line}`),
    // Read-only on purpose: a write-bearing pass against the stale bundle is
    // exactly the blocked heal this recovery exists to unblock. The durable
    // queue is untouched and replays into the rebuilt document below.
    pendingUpdates: [],
    persistedState: currentRecord,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime: state.runtime,
      writerKeyLabel: "writer key",
    }),
    targetSecretKey: encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
    writerProjection:
      state.writerProjection?.documentId === documentId
        ? state.writerProjection
        : undefined,
  });
}

async function rebuildFullHistoryFromRemote(
  state: DocumentStoreState,
): Promise<HistoryRecoveryOutcome> {
  const currentDoc = state.doc;
  const currentRecord = state.record;
  if (!currentDoc || !currentRecord?.documentId) {
    return { kind: "pull-failed" };
  }

  const capturedVersion = encodeVersionVector(currentDoc);
  const uncoveredLocalDelta = pendingDeltaSinceBase(state, currentDoc);
  const pendingUpdates = await listPendingUpdates(state);

  let synced: Awaited<ReturnType<typeof syncRemoteDocument>>;
  try {
    synced = await pullFullRemoteHistory(state, currentRecord);
  } catch {
    return { kind: "pull-failed" };
  }
  if (!synced) {
    return { kind: "pull-failed" };
  }

  // Install on the identity-write chain so a relink cannot land between the
  // checks and the persist. The pull's persisted state and writer projection
  // describe the identity captured above; if a concurrent relink moved the
  // record (state.doc keeps its version across a relink, so the version
  // check alone cannot see one), installing would restore the pre-relink
  // keying metadata. Abort instead; the next blocked pass retries recovery
  // against the new identity.
  return chainIdentityWrite(
    state,
    async (): Promise<HistoryRecoveryOutcome> => {
      if (
        !documentSyncContextMatches(
          state.record,
          currentRecord,
          currentRecord.documentId,
        ) ||
        state.doc !== currentDoc ||
        !versionVectorsEqual(encodeVersionVector(currentDoc), capturedVersion)
      ) {
        return { kind: "doc-changed" };
      }

      try {
        const rebuiltDoc = await createStoredDocument(state);
        importSyncedDocumentUpdates(rebuiltDoc, synced.decryptedUpdates);
        // The read-only pull settles nothing, so the durable queue survives —
        // replay it (plus any not-yet-enqueued local delta) so the rebuilt
        // document contains every local op the heal will re-encrypt.
        importPendingUpdates(rebuiltDoc, pendingUpdates);
        if (uncoveredLocalDelta.byteLength > 0) {
          importUpdates(rebuiltDoc, [uncoveredLocalDelta]);
          await enqueuePendingUpdate(state, uncoveredLocalDelta);
        }
        await installRebuiltDocument({
          currentRecord,
          rebuiltDoc,
          state,
          synced,
        });
      } catch {
        return { kind: "install-failed" };
      }
      return { kind: "recovered", updates: synced.decryptedUpdates.length };
    },
  );
}

/**
 * Serialized behind local writes like the rotation preflight: new writes
 * enqueue behind this promise, so the reconstructed document is installed
 * before they mutate it. Returns true when the rebuilt document was
 * installed and the caller should re-arm sync to retry the heal.
 */
export async function recoverStaleHealFullHistory(
  state: DocumentStoreState,
): Promise<boolean> {
  const documentId = state.record?.documentId;
  if (!documentId) {
    return false;
  }
  const trace = (line: string) => state.runtime.util.log(`Documents: ${line}`);
  if (state.staleHealHistoryRecoveryAttempts >= MAX_HISTORY_RECOVERY_ATTEMPTS) {
    traceHistoryRecoveryFailed(trace, {
      documentId,
      reason: "attempts-exhausted",
    });
    return false;
  }
  state.staleHealHistoryRecoveryAttempts += 1;
  traceHistoryRecoveryStart(trace, {
    attempt: state.staleHealHistoryRecoveryAttempts,
    documentId,
  });

  const recovery = state.writeChain
    .catch(() => undefined)
    .then(() => rebuildFullHistoryFromRemote(state));
  state.writeChain = recovery.then(
    () => undefined,
    () => undefined,
  );
  const outcome = await recovery;
  if (outcome.kind === "recovered") {
    traceHistoryRecovered(trace, { documentId, updates: outcome.updates });
    return true;
  }
  traceHistoryRecoveryFailed(trace, { documentId, reason: outcome.kind });
  return false;
}
