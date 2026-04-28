import { isPlainObject } from "../isPlainObject";
import { hasNumberProperty, hasStringProperty } from "../util";
import {
  type DocumentV2CreateResponse,
  isDocumentV2CreateResponse,
} from "./documentV2";

export interface PublicKeyResponse {
  message: string;
  userId: string;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocumentV2: DocumentV2CreateResponse;
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
    isDocumentV2CreateResponse(Reflect.get(value, "rootMetadataDocumentV2")) &&
    hasStringProperty(value, "challenge")
  );
}
