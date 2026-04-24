import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
  isSerializedRecipientEnvelopeArray,
  type SerializedRecipientEnvelope,
} from "../util";

export interface AttachmentCommitRequest {
  slotId: string;
  stageId: string;
  expectedBindingId: string | null;
}

export interface AttachmentDetachRequest {
  slotId: string;
  expectedBindingId: string;
}

export interface AttachmentRewrapRequest {
  slotId: string;
  expectedBindingId: string;
  recipientEnvelopes: SerializedRecipientEnvelope[];
}

export interface CommitDocumentChangeLoroUpdate {
  checkpointKind?: "fresh_baseline" | "rotate_baseline";
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
  referencedSlotIds: string[];
}

export interface CommitDocumentChangeRequest {
  accessEpoch: number;
  expectedAccessStateHash: string;
  attachmentCommits: AttachmentCommitRequest[];
  attachmentDetaches: AttachmentDetachRequest[];
  attachmentRewraps: AttachmentRewrapRequest[];
  documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
  loroUpdate: CommitDocumentChangeLoroUpdate | null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isAttachmentCommitRequest(
  value: unknown,
): value is AttachmentCommitRequest {
  const expectedBindingId = isPlainObject(value)
    ? Reflect.get(value, "expectedBindingId")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "slotId") &&
    value.slotId.length > 0 &&
    hasStringProperty(value, "stageId") &&
    value.stageId.length > 0 &&
    isNullableString(expectedBindingId)
  );
}

function isAttachmentDetachRequest(
  value: unknown,
): value is AttachmentDetachRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "slotId") &&
    value.slotId.length > 0 &&
    hasStringProperty(value, "expectedBindingId") &&
    value.expectedBindingId.length > 0
  );
}

function isAttachmentRewrapRequest(
  value: unknown,
): value is AttachmentRewrapRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "slotId") &&
    value.slotId.length > 0 &&
    hasStringProperty(value, "expectedBindingId") &&
    value.expectedBindingId.length > 0 &&
    hasArrayProperty(value, "recipientEnvelopes") &&
    isSerializedRecipientEnvelopeArray(value.recipientEnvelopes)
  );
}

function isCommitDocumentChangeLoroUpdate(
  value: unknown,
): value is CommitDocumentChangeLoroUpdate {
  const checkpointKind = isPlainObject(value)
    ? Reflect.get(value, "checkpointKind")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    (checkpointKind === undefined ||
      checkpointKind === "fresh_baseline" ||
      checkpointKind === "rotate_baseline") &&
    (Reflect.get(value, "sourceVersionVector") === undefined ||
      hasStringProperty(value, "sourceVersionVector")) &&
    hasArrayProperty(value, "referencedSlotIds") &&
    isStringArray(value.referencedSlotIds)
  );
}

export function isCommitDocumentChangeRequest(
  value: unknown,
): value is CommitDocumentChangeRequest {
  const documentRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopes")
    : undefined;
  const loroUpdate = isPlainObject(value)
    ? Reflect.get(value, "loroUpdate")
    : undefined;

  return (
    isPlainObject(value) &&
    hasNumberProperty(value, "accessEpoch") &&
    Number.isInteger(value.accessEpoch) &&
    value.accessEpoch > 0 &&
    hasStringProperty(value, "expectedAccessStateHash") &&
    value.expectedAccessStateHash.length > 0 &&
    hasArrayProperty(value, "attachmentCommits") &&
    value.attachmentCommits.every(isAttachmentCommitRequest) &&
    hasArrayProperty(value, "attachmentDetaches") &&
    value.attachmentDetaches.every(isAttachmentDetachRequest) &&
    hasArrayProperty(value, "attachmentRewraps") &&
    value.attachmentRewraps.every(isAttachmentRewrapRequest) &&
    (documentRecipientEnvelopes === undefined ||
      isSerializedRecipientEnvelopeArray(documentRecipientEnvelopes)) &&
    ((hasObjectProperty(value, "loroUpdate") &&
      isCommitDocumentChangeLoroUpdate(loroUpdate)) ||
      loroUpdate === null)
  );
}
