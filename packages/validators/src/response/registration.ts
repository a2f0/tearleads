import { isPlainObject } from "../isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
  isAuthChallengeHexString,
} from "../util";
import {
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "./documentMutation";

export interface RegistrationResponse {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocument: DocumentCreateResponse;
  rosterProfileDocument?: DocumentCreateResponse | undefined;
  rosterProfileDocumentId?: string | undefined;
  challenge: string;
}

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "rootContainerId") &&
    hasStringProperty(value, "rootMetadataDocumentId") &&
    hasNumberProperty(value, "rootMetadataAccessEpoch") &&
    hasStringProperty(value, "rootMetadataAccessStateHash") &&
    value.rootMetadataAccessStateHash.length > 0 &&
    isDocumentCreateResponse(Reflect.get(value, "rootMetadataDocument")) &&
    (Reflect.get(value, "rosterProfileDocument") === undefined ||
      isDocumentCreateResponse(Reflect.get(value, "rosterProfileDocument"))) &&
    (Reflect.get(value, "rosterProfileDocumentId") === undefined ||
      hasStringProperty(value, "rosterProfileDocumentId")) &&
    hasStringProperty(value, "challenge") &&
    isAuthChallengeHexString(value.challenge)
  );
}
