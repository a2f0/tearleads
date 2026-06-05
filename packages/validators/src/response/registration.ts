import { isPlainObject } from "../isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
  isAuthChallengeHexString,
} from "../util";
import {
  type ContainerCreateWithMetadataDocumentResponse,
  isContainerCreateWithMetadataDocumentResponse,
} from "./containerMetadata";
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
  rosterProfileContainer?:
    | ContainerCreateWithMetadataDocumentResponse
    | undefined;
  rosterProfileContainerId?: string | undefined;
  rosterProfileDocument?: DocumentCreateResponse | undefined;
  rosterProfileDocumentId?: string | undefined;
  organizationProfileDocument?: DocumentCreateResponse | undefined;
  organizationProfileDocumentId?: string | undefined;
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
    (Reflect.get(value, "rosterProfileContainer") === undefined ||
      isContainerCreateWithMetadataDocumentResponse(
        Reflect.get(value, "rosterProfileContainer"),
      )) &&
    (Reflect.get(value, "rosterProfileContainerId") === undefined ||
      hasStringProperty(value, "rosterProfileContainerId")) &&
    (Reflect.get(value, "rosterProfileDocument") === undefined ||
      isDocumentCreateResponse(Reflect.get(value, "rosterProfileDocument"))) &&
    (Reflect.get(value, "rosterProfileDocumentId") === undefined ||
      hasStringProperty(value, "rosterProfileDocumentId")) &&
    (Reflect.get(value, "organizationProfileDocument") === undefined ||
      isDocumentCreateResponse(
        Reflect.get(value, "organizationProfileDocument"),
      )) &&
    (Reflect.get(value, "organizationProfileDocumentId") === undefined ||
      hasStringProperty(value, "organizationProfileDocumentId")) &&
    hasStringProperty(value, "challenge") &&
    isAuthChallengeHexString(value.challenge)
  );
}
