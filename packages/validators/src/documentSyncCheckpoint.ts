export const DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND = "rotate_baseline";
export const DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND =
  "full_history_snapshot";
export const DOCUMENT_SYNC_CHECKPOINT_FIELD_SET_ISSUE_MESSAGE =
  "checkpoint fields must be absent or form a rotation baseline";

interface DocumentSyncCheckpointFields {
  readonly checkpointKind?:
    | typeof DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND
    | undefined;
  readonly checkpointPayloadKind?:
    | typeof DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND
    | undefined;
  readonly sourceVersionVector?: string | undefined;
}

export type DocumentSyncCheckpointFieldClassification =
  | "absent"
  | "invalid"
  | "rotation-baseline";

export function classifyDocumentSyncCheckpointFields({
  checkpointKind,
  checkpointPayloadKind,
  sourceVersionVector,
}: DocumentSyncCheckpointFields): DocumentSyncCheckpointFieldClassification {
  if (
    checkpointKind === undefined &&
    checkpointPayloadKind === undefined &&
    sourceVersionVector === undefined
  ) {
    return "absent";
  }

  if (
    checkpointKind === DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND &&
    checkpointPayloadKind === DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND &&
    sourceVersionVector !== undefined
  ) {
    return "rotation-baseline";
  }

  return "invalid";
}
