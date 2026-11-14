import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  lockAccessManifestHeadRows,
  type StoredAccessManifestHead,
} from "../../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../../utils/array";
import { BlobMutationError } from "./types";

function assertEveryPlannedHeadWasLocked(
  plannedIds: readonly string[],
  lockedIds: readonly string[],
): void {
  const expectedIds = uniqueSortedStrings(plannedIds);
  if (
    expectedIds.length !== lockedIds.length ||
    expectedIds.some((objectId, index) => objectId !== lockedIds[index])
  ) {
    throw new BlobMutationError("Blob content-key target heads are stale", 409);
  }
}

interface DocumentHeadLockRun {
  readonly mode: "share" | "update";
  readonly objectIds: readonly string[];
}

/**
 * Split the sorted document heads into consecutive runs by lock mode, so a
 * bind that carries a document sync takes its own head FOR UPDATE in the same
 * sorted position the shared heads around it keep.
 */
export function planAttachmentDocumentHeadLockRuns(
  documentIds: readonly string[],
  exclusiveDocumentId: string | undefined,
): DocumentHeadLockRun[] {
  const runs: { mode: "share" | "update"; objectIds: string[] }[] = [];
  for (const documentId of uniqueSortedStrings(documentIds)) {
    const mode = documentId === exclusiveDocumentId ? "update" : "share";
    const last = runs.at(-1);
    if (last?.mode === mode) {
      last.objectIds.push(documentId);
    } else {
      runs.push({ mode, objectIds: [documentId] });
    }
  }
  return runs;
}

export async function lockAttachmentAuthorizationHeadsForShare(input: {
  readonly containerIds: readonly string[];
  readonly documentIds: readonly string[];
  /**
   * The bound document when the bind carries a document sync: its write needs
   * the head FOR UPDATE, taken here before any blob-row lock rather than
   * upgraded later, which would deadlock against a second sharer.
   */
  readonly exclusiveDocumentId?: string | undefined;
  readonly executor: DatabaseTransaction;
}): Promise<{
  readonly containerHeads: ReadonlyMap<string, StoredAccessManifestHead>;
  readonly documentHeads: ReadonlyMap<string, StoredAccessManifestHead>;
}> {
  const containerRows = await lockAccessManifestHeadRows(
    "container",
    input.containerIds,
    input.executor,
    "share",
  );
  assertEveryPlannedHeadWasLocked(
    input.containerIds,
    containerRows.map((row) => row.objectId),
  );

  const documentRows: StoredAccessManifestHead[] = [];
  for (const run of planAttachmentDocumentHeadLockRuns(
    input.documentIds,
    input.exclusiveDocumentId,
  )) {
    documentRows.push(
      ...(await lockAccessManifestHeadRows(
        "document",
        run.objectIds,
        input.executor,
        run.mode,
      )),
    );
  }
  assertEveryPlannedHeadWasLocked(
    input.documentIds,
    documentRows.map((row) => row.objectId),
  );
  return {
    containerHeads: new Map(containerRows.map((row) => [row.objectId, row])),
    documentHeads: new Map(documentRows.map((row) => [row.objectId, row])),
  };
}
