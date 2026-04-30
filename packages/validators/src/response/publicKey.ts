import { isPlainObject } from "../isPlainObject";
import { hasNumberProperty, hasStringProperty } from "../util";
import {
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "./documentMutation";

export interface PublicKeyResponse {
  message: string;
  userId: string;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocument: DocumentCreateResponse;
  challenge: string;
}

export function isPublicKeyResponse(
  value: unknown,
): value is PublicKeyResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "message") &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "rootContainerId") &&
    hasStringProperty(value, "rootMetadataDocumentId") &&
    hasNumberProperty(value, "rootMetadataAccessEpoch") &&
    hasStringProperty(value, "rootMetadataAccessStateHash") &&
    value.rootMetadataAccessStateHash.length > 0 &&
    isDocumentCreateResponse(Reflect.get(value, "rootMetadataDocument")) &&
    hasStringProperty(value, "challenge")
  );
}
