import {
  exportUpdatesInVersionRange,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { errorMessage } from "../../../../data/shared/errorMessage";
import type {
  ExecSql,
  PendingUpdateRecord,
} from "../../../../workflows/documents";
import {
  listPendingUpdates,
  withGenerationGuardedMutation,
} from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";
import {
  planQueuedUpdateMerge,
  QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS,
  type QueuedUpdateMergeGroup,
} from "./syncQueueMergePlan";

/**
 * The merged update for a group: exactly the live document's operations in
 * the group's union range, whose decoded metadata must be an `update` with
 * exactly that start and end, within the size cap. Otherwise null.
 */
function mergedGroupFields(
  doc: DocumentState,
  group: QueuedUpdateMergeGroup,
): {
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  updateData: string;
} | null {
  const blob = exportUpdatesInVersionRange(
    doc,
    group.partialStartVersionVector,
    group.partialEndVersionVector,
  );
  if (!blob) return null;
  const metadata = getImportBlobMetadata(blob);
  if (
    metadata.mode !== "update" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      group.partialStartVersionVector,
    ) ||
    !versionVectorsEqual(
      metadata.partialEndVersionVector,
      group.partialEndVersionVector,
    )
  ) {
    return null;
  }
  const fields = createPendingUpdateFields(blob);
  if (
    !fields ||
    fields.updateData.length > QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS
  ) {
    return null;
  }
  return {
    partialEndVersionVector: fields.partialEndVersionVector,
    partialStartVersionVector: fields.partialStartVersionVector,
    updateData: fields.updateData,
  };
}

/**
 * Merge runs of queued local updates before a send, so a typing burst or an
 * offline backlog (including rows from earlier sessions) goes out as one
 * update per run instead of one per write. Runs inside the pass's exclusive
 * remote work, so none of this runtime's rows is in flight. The queue is
 * re-listed and planned under the SQL lock and generation guard, and each
 * group is replaced through the fenced, all-or-nothing persistence port; a
 * group whose checks fail stays as it is. Coverage markers are untouched.
 *
 * Best-effort: a failure is logged and the queue is sent as it stands.
 * Resolves to the queue to send.
 */
export async function mergeQueuedDocumentUpdates(input: {
  readonly currentDoc: DocumentState;
  readonly generation: DocumentStoreSyncGeneration;
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly state: DocumentStoreState;
}): Promise<PendingUpdateRecord[]> {
  const { currentDoc, state } = input;
  const expectedDocumentId = state.record?.documentId;
  if (input.pendingUpdates.length < 2 || expectedDocumentId === undefined) {
    return input.pendingUpdates;
  }
  const expectedRecoveryGeneration = state.record?.recoveryGeneration ?? 0;
  let mergedGroups = 0;
  const replaceGroup = async (
    execSql: ExecSql,
    group: QueuedUpdateMergeGroup,
  ) => {
    const merged = mergedGroupFields(currentDoc, group);
    if (!merged) return;
    const updateId = await state.persistence.replaceQueuedPendingUpdates(
      execSql,
      {
        expectedDocumentId,
        expectedRecoveryGeneration,
        localId: state.localId,
        memberUpdateIds: group.members.map((member) => member.id),
        merged,
        rekeyCount: group.rekeyCount,
      },
    );
    if (updateId !== null) mergedGroups += 1;
  };
  try {
    await withGenerationGuardedMutation(
      state,
      input.generation,
      async (execSql) => {
        const rows = await state.persistence.listPendingUpdates(
          execSql,
          state.localId,
        );
        for (const group of planQueuedUpdateMerge({ doc: currentDoc, rows })) {
          await replaceGroup(execSql, group);
        }
      },
    );
  } catch (error) {
    state.runtime.util.log(
      `Documents: queued update merge skipped: ${errorMessage(error)}`,
    );
  }
  return mergedGroups === 0 ? input.pendingUpdates : listPendingUpdates(state);
}
