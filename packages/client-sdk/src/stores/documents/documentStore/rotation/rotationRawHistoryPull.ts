import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import {
  claimThenReadDocumentRotationPageLimit,
  createDocumentSyncLoroWindow,
  createDocumentWriterPublicKeyResolver,
  DOCUMENTS_APP_KIND,
  type DocumentSyncPullContinuation,
  RemoteDocumentService,
  readPullContinuation,
  resolveDocumentCreateAuthor,
  runDocumentSyncLoroWork,
  settleDocumentSyncLoroWindow,
} from "../../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { deleteUpstreamDeletedDocument } from "../sync/syncRequest";
import { importSyncedDocumentUpdates } from "../sync/syncUpdateImport";
import {
  type RotationRawHistoryVoids,
  rotationIncomingUpdateIsolation,
} from "./rotationRawHistoryJudge";

export function assertRotationRecoveryPrerequisites(state: DocumentStoreState) {
  if (state.persistence.supportsAtomicRecoveryHistoryPruning !== true) {
    throw new Error(
      "Rotation raw-history recovery requires an adapter with atomic local-history pruning",
    );
  }
  const author = resolveDocumentCreateAuthor(state.runtime);
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  const documentId = state.record?.documentId;
  if (
    !author ||
    !encapsulationKeyPair ||
    !documentId ||
    !state.runtime.auth.isAuthenticated ||
    !state.runtime.state.online
  ) {
    throw new Error(
      "Rotation requires verified full-history recovery, but remote sync prerequisites are unavailable",
    );
  }
  return { author, documentId, encapsulationKeyPair };
}

export function assertRotationRecoveryGeneration(input: {
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): void {
  if (!isDocumentStoreSyncGenerationCurrent(input.state, input.generation)) {
    throw new Error(
      "Document changed during rotation recovery; retry key rotation",
    );
  }
}

export async function pullVerifiedRawHistoryForRotation(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
  /** Updates the rebuild leaves out, unread (`rotationAvailabilityMachine`). */
  leftOut: readonly string[];
  rebuiltDocument: DocumentState;
  state: DocumentStoreState;
  voids: RotationRawHistoryVoids;
}) {
  const { author, documentId, encapsulationKeyPair } =
    assertRotationRecoveryPrerequisites(input.state);
  let pullContinuation: DocumentSyncPullContinuation | undefined;
  const seenPullCursors = new Set<string>();
  let planningRecord = input.currentRecord;
  let writerProjection =
    input.state.writerProjection?.documentId === documentId &&
    !isRejectedDecodedProjection(input.state.writerProjection)
      ? input.state.writerProjection
      : undefined;

  while (true) {
    const synced = await pullRawRotationPage(input, {
      author,
      documentId,
      encapsulationKeyPair,
      planningRecord,
      pullContinuation,
      writerProjection,
    });
    if (!synced.hasIncompletePull) return synced;

    const nextContinuation = readPullContinuation(synced.response);
    if (!nextContinuation) {
      throw new Error(
        "Rotation raw-history recovery ended before the retained history was complete",
      );
    }
    if (seenPullCursors.has(nextContinuation.cursor)) {
      throw new Error(
        "Rotation raw-history recovery encountered a repeated pull cursor",
      );
    }
    seenPullCursors.add(nextContinuation.cursor);
    pullContinuation = nextContinuation;
    planningRecord = { ...planningRecord, ...synced.persistedState };
    writerProjection = synced.writerProjection;
  }
}

type RawRotationPullInput = Parameters<
  typeof pullVerifiedRawHistoryForRotation
>[0];

/**
 * Pulls, judges, and rebuilds one raw-history page. Its served updates are
 * read only inside the page's Loro window, through the rebuild's import of
 * them, and the pull asks for one update while the scope isolates updates a
 * death left (#3194).
 */
async function pullRawRotationPage(
  input: RawRotationPullInput,
  page: ReturnType<typeof assertRotationRecoveryPrerequisites> & {
    readonly planningRecord: NonNullable<DocumentStoreState["record"]>;
    readonly pullContinuation: DocumentSyncPullContinuation | undefined;
    readonly writerProjection: Parameters<
      RemoteDocumentService["syncRemoteDocument"]
    >[0]["writerProjection"];
  },
) {
  const { author, documentId, encapsulationKeyPair } = page;
  const { planningRecord, pullContinuation, writerProjection } = page;
  const maxPageUpdates = await claimThenReadDocumentRotationPageLimit({
    documentId,
    execSql: input.state.runtime.infra.execSql,
    isCurrent: () =>
      isDocumentStoreSyncGenerationCurrent(input.state, input.generation),
    logError: input.state.runtime.util.logError,
    scope: { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
  });
  const loroWindow = createDocumentSyncLoroWindow();
  try {
    let abandonReason: string | null = null;
    // Each page reads the live runtime, as the bag it replaced did; the key
    // stays the one the prerequisites checked.
    const remoteDocuments = new RemoteDocumentService({
      api: input.state.runtime.apiClient,
      encapsulationSecretKey: encapsulationKeyPair.secretKey,
      execSql: input.state.runtime.infra.execSql,
      isRemoteSyncBlocked: input.state.runtime.util.isRemoteSyncBlocked,
    });
    const synced = await remoteDocuments.syncRemoteDocument({
      author,
      documentId,
      historyMode: "raw",
      localVersionVector: null,
      maxPageUpdates,
      minLsn: input.currentRecord.lastCommitLsn ?? undefined,
      onRemoteDocumentDeleted: ({ commitPurgeProof, documentId }) =>
        deleteUpstreamDeletedDocument(
          input.state,
          input.generation,
          input.currentRecord,
          documentId,
          commitPurgeProof,
        ),
      // Recorded, never parked: this pass submits no writes, so it plans no
      // ancestor repair and cannot abandon as `inaccessible`.
      onSyncAbandoned: (reason) => {
        abandonReason = reason;
      },
      ...rotationIncomingUpdateIsolation({
        currentDocument: input.rebuiltDocument,
        documentId,
        generation: input.generation,
        leftOut: input.leftOut,
        loroWindow,
        state: input.state,
      }),
      onSyncTrace: (line) => input.state.runtime.util.log(`Documents: ${line}`),
      pendingUpdates: [],
      persistedState: planningRecord,
      pullContinuation,
      resolveProjectionUserKey: input.state.resolveProjectionUserKey,
      resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
        logPrefix: "Documents",
        runtime: input.state.runtime,
        writerKeyLabel: "writer key",
      }),
      warmReferencedPrincipalPolicies:
        input.state.runtime.principalPolicies.createWarmer(),
      writerProjection,
    });
    if (!synced) {
      throw new Error(
        `Rotation raw-history recovery could not complete (${abandonReason ?? "sync did not finish"}); key rotation was not started`,
      );
    }

    assertRotationRecoveryGeneration(input);
    input.voids.notePage(synced);
    // Exactly what a sync pass applies: every accepted served update,
    // checkpoints included. A void or unsettled one never gets here.
    runDocumentSyncLoroWork(loroWindow, () =>
      importSyncedDocumentUpdates(
        input.rebuiltDocument,
        synced.decryptedUpdates,
      ),
    );
    return synced;
  } finally {
    await settleDocumentSyncLoroWindow(loroWindow, null);
  }
}
