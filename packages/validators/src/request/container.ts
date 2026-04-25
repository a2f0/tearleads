import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasStringProperty,
  isSerializedRecipientEnvelopeArray,
  isUuidV4String,
  type SerializedRecipientEnvelope,
} from "../util";
import {
  type EncryptedDocumentUpdate,
  isEncryptedDocumentUpdate,
} from "./documentUpdate";

export interface CreateContainerRequest {
  expectedAccessStateHash: string;
  id: string;
  initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
  parentId: string;
  initialMetadataUpdates: EncryptedDocumentUpdate[];
}

export interface ShareContainerRequest {
  expectedAccessStateHash: string;
  subjectType: "user" | "group" | "organization";
  subjectId: string;
  accessLevel: "read" | "write" | "admin";
}

export interface MoveContainerRequest {
  expectedAccessStateHash: string;
  parentId: string;
}

export interface LinkDocumentToContainerRequest {
  containerId: string;
  expectedAccessStateHash: string;
}

function isShareSubjectType(
  value: string,
): value is ShareContainerRequest["subjectType"] {
  return value === "user" || value === "group" || value === "organization";
}

function isShareAccessLevel(
  value: string,
): value is ShareContainerRequest["accessLevel"] {
  return value === "read" || value === "write" || value === "admin";
}

export function isCreateContainerRequest(
  value: unknown,
): value is CreateContainerRequest {
  const initialMetadataRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "initialMetadataRecipientEnvelopes")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "expectedAccessStateHash") &&
    value.expectedAccessStateHash.length > 0 &&
    hasStringProperty(value, "id") &&
    isUuidV4String(value.id) &&
    hasStringProperty(value, "parentId") &&
    isUuidV4String(value.parentId) &&
    (initialMetadataRecipientEnvelopes === undefined ||
      isSerializedRecipientEnvelopeArray(initialMetadataRecipientEnvelopes)) &&
    hasArrayProperty(value, "initialMetadataUpdates") &&
    value.initialMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}

export function isShareContainerRequest(
  value: unknown,
): value is ShareContainerRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "expectedAccessStateHash") &&
    value.expectedAccessStateHash.length > 0 &&
    hasStringProperty(value, "subjectType") &&
    isShareSubjectType(value.subjectType) &&
    hasStringProperty(value, "subjectId") &&
    isUuidV4String(value.subjectId) &&
    hasStringProperty(value, "accessLevel") &&
    isShareAccessLevel(value.accessLevel)
  );
}

export function isMoveContainerRequest(
  value: unknown,
): value is MoveContainerRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "expectedAccessStateHash") &&
    value.expectedAccessStateHash.length > 0 &&
    hasStringProperty(value, "parentId") &&
    isUuidV4String(value.parentId)
  );
}

export function isLinkDocumentToContainerRequest(
  value: unknown,
): value is LinkDocumentToContainerRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    isUuidV4String(value.containerId) &&
    hasStringProperty(value, "expectedAccessStateHash") &&
    value.expectedAccessStateHash.length > 0
  );
}
