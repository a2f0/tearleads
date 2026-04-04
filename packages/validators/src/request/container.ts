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
