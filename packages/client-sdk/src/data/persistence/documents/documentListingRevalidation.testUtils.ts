import { encodeVersionVectorCounters } from "@tearleads/loro";
import type { ExecSql } from "../../sqlite/sqlSchema";

export const LISTING_JUDGE = "void-rules-1:loro-crdt@1.0.0";
export const HELD_FRONTIER = encodeVersionVectorCounters({ "7": 4 });

/** The access head a held record's key bundle names unless a test says otherwise. */
export const heldHead = (documentId: string) => `head:${documentId}`;

/** A cursor a record's last completed pull left. */
export interface HeldCursor {
  readonly count: number | null;
  readonly documentId?: string;
  readonly judge?: string;
  readonly version?: string;
}

/**
 * A held record of `documentId`, and the cursor its last completed pull
 * left, if any. Its key bundle names `head` (null for a record with no
 * bundle), and the manifest kept beside it is that head at `epoch`.
 */
export async function holdListedRecord(
  execSql: ExecSql,
  input: {
    readonly cursor?: HeldCursor;
    readonly documentId: string;
    readonly epoch?: number;
    readonly frontier?: string;
    readonly head?: string | null;
    readonly judge?: string;
    readonly localId?: string;
  },
): Promise<string> {
  const localId = input.localId ?? `local-${input.documentId}`;
  const head =
    input.head === undefined ? heldHead(input.documentId) : input.head;
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, content_key_bundle, document_manifest_bundle,
       updated_at)
     VALUES ('documents', ?, ?, ?, ?, ?, '2026-11-25T00:00:00.000Z')`,
    [
      localId,
      input.documentId,
      input.frontier ?? HELD_FRONTIER,
      head === null ? null : JSON.stringify({ linkSetManifestHash: head }),
      head === null
        ? null
        : JSON.stringify({
            manifest: { epoch: input.epoch ?? 1 },
            manifestHash: head,
          }),
    ],
  );
  if (input.cursor) await saveHeldCursor(execSql, localId, input);
  return localId;
}

/** Saves, or replaces, the cursor a record's last completed pull left. */
export async function saveHeldCursor(
  execSql: ExecSql,
  localId: string,
  input: {
    readonly cursor?: HeldCursor;
    readonly documentId: string;
    readonly judge?: string;
  },
): Promise<void> {
  const cursor = input.cursor ?? { count: null };
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_update_count, through_version, judge)
     VALUES ('documents', ?, ?, 'update', ?, ?, ?)
     ON CONFLICT (app_kind, local_id) DO UPDATE SET
       document_id = excluded.document_id,
       through_update_count = excluded.through_update_count,
       through_version = excluded.through_version,
       judge = excluded.judge`,
    [
      localId,
      cursor.documentId ?? input.documentId,
      cursor.count,
      cursor.version ?? HELD_FRONTIER,
      cursor.judge ?? input.judge ?? LISTING_JUDGE,
    ],
  );
}

/** Moves a record's key bundle, as a pull's save does, to `head` at `epoch`. */
export async function saveHeldHead(
  execSql: ExecSql,
  localId: string,
  head: string,
  epoch: number,
): Promise<void> {
  await execSql(
    `UPDATE documents SET content_key_bundle = ?, document_manifest_bundle = ?
     WHERE app_kind = 'documents' AND local_id = ?`,
    [
      JSON.stringify({ linkSetManifestHash: head }),
      JSON.stringify({ manifest: { epoch }, manifestHash: head }),
      localId,
    ],
  );
}
