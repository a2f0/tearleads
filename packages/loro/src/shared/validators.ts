import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasNumberProperty,
  hasStringProperty,
  isSerializedRecipientEnvelopeArray,
  type SerializedRecipientEnvelope,
} from "@tearleads/validators/util";

export type DocumentCheckpointKind = "fresh_baseline" | "rotate_baseline";

export interface SyncDocumentOutgoingUpdate {
  checkpointKind?: DocumentCheckpointKind;
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}

export type DocumentRecipientEnvelopeAction = "none" | "rewrap" | "rotate";

export const DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE =
  "Document recipient envelopes conflict";

export type SyncDocumentMissingUpdateEpoch = "prior_epoch" | "current_epoch";

export interface CreateDocumentRequest {
  linkedContainerIds: string[];
}

export interface CreateDocumentResponse {
  id: string;
  createdAt: string;
  currentAccessEpoch: number;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  recipientEncapsulationPublicKeys: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export interface SyncDocumentRequest {
  accessEpoch: number;
  documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
  localVersionVector: string | null;
  minLsn?: string;
  outgoingUpdates: SyncDocumentOutgoingUpdate[];
}

export interface DocumentSyncUpdate {
  accessEpoch: number;
  id: string;
  documentId: string;
  authorFingerprint: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  createdAt: string;
}

export interface SyncDocumentResponse {
  documentId: string;
  acceptedOutgoingUpdateIds: string[];
  canonicalDocumentRecipientEnvelopesAdopted: boolean;
  commitLsn: string | null;
  missingUpdateEpochs: SyncDocumentMissingUpdateEpoch[];
  updates: DocumentSyncUpdate[];
  currentAccessEpoch: number;
  documentRecipientEnvelopeAction: DocumentRecipientEnvelopeAction;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  rotateBaselineSourceVersionVector: string | null;
  recipientEncapsulationPublicKeys: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
}

function hasPositiveNumberProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number> {
  return (
    hasNumberProperty(value, key) &&
    Number.isInteger(value[key]) &&
    value[key] > 0
  );
}

function hasNullableStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string | null> {
  return value[key] === null || typeof value[key] === "string";
}

function isWalLsnString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-F]+\/[0-9A-F]+$/i.test(value);
}

function hasStringArrayProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string[]> {
  return (
    hasArrayProperty(value, key) &&
    value[key].every((entry) => typeof entry === "string")
  );
}

function isDocumentRecipientEnvelopeAction(
  value: unknown,
): value is DocumentRecipientEnvelopeAction {
  return value === "none" || value === "rewrap" || value === "rotate";
}

function isDocumentCheckpointKind(
  value: unknown,
): value is DocumentCheckpointKind {
  return value === "fresh_baseline" || value === "rotate_baseline";
}

function isSyncDocumentMissingUpdateEpoch(
  value: unknown,
): value is SyncDocumentMissingUpdateEpoch {
  return value === "prior_epoch" || value === "current_epoch";
}

export function isSyncDocumentOutgoingUpdate(
  value: unknown,
): value is SyncDocumentOutgoingUpdate {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    (Reflect.get(value, "checkpointKind") === undefined ||
      isDocumentCheckpointKind(Reflect.get(value, "checkpointKind"))) &&
    (Reflect.get(value, "sourceVersionVector") === undefined ||
      hasStringProperty(value, "sourceVersionVector"))
  );
}

export function isCreateDocumentRequest(
  value: unknown,
): value is CreateDocumentRequest {
  return (
    isPlainObject(value) &&
    hasStringArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.length > 0
  );
}

export function isCreateDocumentResponse(
  value: unknown,
): value is CreateDocumentResponse {
  const documentRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopes")
    : undefined;
  const referencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipals")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "createdAt") &&
    hasPositiveNumberProperty(value, "currentAccessEpoch") &&
    (documentRecipientEnvelopes === null ||
      isSerializedRecipientEnvelopeArray(documentRecipientEnvelopes)) &&
    hasStringArrayProperty(value, "recipientEncapsulationPublicKeys") &&
    (referencedPrincipals === undefined ||
      (Array.isArray(referencedPrincipals) &&
        referencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isSyncDocumentRequest(
  value: unknown,
): value is SyncDocumentRequest {
  const documentRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopes")
    : undefined;
  const minLsn = isPlainObject(value)
    ? Reflect.get(value, "minLsn")
    : undefined;

  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "accessEpoch") &&
    (documentRecipientEnvelopes === undefined ||
      isSerializedRecipientEnvelopeArray(documentRecipientEnvelopes)) &&
    hasNullableStringProperty(value, "localVersionVector") &&
    (minLsn === undefined || isWalLsnString(minLsn)) &&
    hasArrayProperty(value, "outgoingUpdates") &&
    value.outgoingUpdates.every(isSyncDocumentOutgoingUpdate)
  );
}

export function isDocumentSyncUpdate(
  value: unknown,
): value is DocumentSyncUpdate {
  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "accessEpoch") &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "authorFingerprint") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isSyncDocumentResponse(
  value: unknown,
): value is SyncDocumentResponse {
  const documentRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopes")
    : undefined;
  const documentRecipientEnvelopeAction = isPlainObject(value)
    ? Reflect.get(value, "documentRecipientEnvelopeAction")
    : undefined;
  const referencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipals")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    hasArrayProperty(value, "acceptedOutgoingUpdateIds") &&
    value.acceptedOutgoingUpdateIds.every(
      (entry) => typeof entry === "string",
    ) &&
    hasBooleanProperty(value, "canonicalDocumentRecipientEnvelopesAdopted") &&
    hasNullableStringProperty(value, "commitLsn") &&
    hasArrayProperty(value, "missingUpdateEpochs") &&
    value.missingUpdateEpochs.every(isSyncDocumentMissingUpdateEpoch) &&
    hasArrayProperty(value, "updates") &&
    value.updates.every(isDocumentSyncUpdate) &&
    hasPositiveNumberProperty(value, "currentAccessEpoch") &&
    isDocumentRecipientEnvelopeAction(documentRecipientEnvelopeAction) &&
    (documentRecipientEnvelopes === null ||
      isSerializedRecipientEnvelopeArray(documentRecipientEnvelopes)) &&
    hasNullableStringProperty(value, "rotateBaselineSourceVersionVector") &&
    hasStringArrayProperty(value, "recipientEncapsulationPublicKeys") &&
    (referencedPrincipals === undefined ||
      (Array.isArray(referencedPrincipals) &&
        referencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}
