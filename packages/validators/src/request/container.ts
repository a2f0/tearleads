import { isPlainObject } from "../isPlainObject";
import { hasArrayProperty, hasStringProperty } from "../util";
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
    hasStringProperty(value, "parentId") &&
    hasArrayProperty(value, "initialMetadataUpdates") &&
    value.initialMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}
