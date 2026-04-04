import { isPlainObject } from "../isPlainObject";
import { hasArrayProperty, hasStringProperty, isUuidV4String } from "../util";
import {
  type EncryptedDocumentUpdate,
  isEncryptedDocumentUpdate,
} from "./documentUpdate";

export interface CreateContainerRequest {
  id: string;
  parentId: string;
  initialMetadataUpdates: EncryptedDocumentUpdate[];
}

export interface ShareContainerRequest {
  subjectType: "user" | "group" | "organization";
  subjectId: string;
  accessLevel: "read" | "write" | "admin";
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
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    isUuidV4String(value.id) &&
    hasStringProperty(value, "parentId") &&
    isUuidV4String(value.parentId) &&
    hasArrayProperty(value, "initialMetadataUpdates") &&
    value.initialMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}

export function isShareContainerRequest(
  value: unknown,
): value is ShareContainerRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "subjectType") &&
    isShareSubjectType(value.subjectType) &&
    hasStringProperty(value, "subjectId") &&
    isUuidV4String(value.subjectId) &&
    hasStringProperty(value, "accessLevel") &&
    isShareAccessLevel(value.accessLevel)
  );
}
