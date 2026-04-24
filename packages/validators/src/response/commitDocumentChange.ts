import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
  isSerializedRecipientEnvelopeArray,
  type SerializedRecipientEnvelope,
} from "../util";

interface CommittedBindingResponse {
  slotId: string;
  bindingId: string;
  blobId: string;
}

export interface CommitDocumentChangeResponse {
  currentAccessEpoch: number;
  currentAccessStateHash?: string;
  acceptedOutgoingUpdateIds: string[];
  committedBindings: CommittedBindingResponse[];
  detachedBindingIds: string[];
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
}

function isCommittedBindingResponse(
  value: unknown,
): value is CommittedBindingResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "slotId") &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function isCommitDocumentChangeResponse(
  value: unknown,
): value is CommitDocumentChangeResponse {
  const documentRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopes")
    : undefined;
  const currentAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "currentAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    Number.isInteger(value.currentAccessEpoch) &&
    value.currentAccessEpoch > 0 &&
    (currentAccessStateHash === undefined ||
      typeof currentAccessStateHash === "string") &&
    hasArrayProperty(value, "acceptedOutgoingUpdateIds") &&
    isStringArray(value.acceptedOutgoingUpdateIds) &&
    hasArrayProperty(value, "committedBindings") &&
    value.committedBindings.every(isCommittedBindingResponse) &&
    hasArrayProperty(value, "detachedBindingIds") &&
    isStringArray(value.detachedBindingIds) &&
    (documentRecipientEnvelopes === null ||
      isSerializedRecipientEnvelopeArray(documentRecipientEnvelopes))
  );
}
