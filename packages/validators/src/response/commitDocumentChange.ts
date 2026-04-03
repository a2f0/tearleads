import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

interface CommittedBindingResponse {
  slotId: string;
  bindingId: string;
  blobId: string;
}

export interface CommitDocumentChangeResponse {
  currentAccessEpoch: number;
  acceptedOutgoingUpdateIds: string[];
  committedBindings: CommittedBindingResponse[];
  detachedBindingIds: string[];
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
  return (
    isPlainObject(value) &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    Number.isInteger(value.currentAccessEpoch) &&
    value.currentAccessEpoch > 0 &&
    hasArrayProperty(value, "acceptedOutgoingUpdateIds") &&
    isStringArray(value.acceptedOutgoingUpdateIds) &&
    hasArrayProperty(value, "committedBindings") &&
    value.committedBindings.every(isCommittedBindingResponse) &&
    hasArrayProperty(value, "detachedBindingIds") &&
    isStringArray(value.detachedBindingIds)
  );
}
