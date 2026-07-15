import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  type EffectiveAccessLevel,
  isEffectiveAccessLevel,
} from "./accessLevel";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";
import { isSyncWatermark, type SyncWatermark } from "./syncWatermark";

export interface ContainerDocumentSummary {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  effectiveAccessLevel: EffectiveAccessLevel;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

export interface ContainerDocumentSyncTombstone {
  containerId: string;
  documentId: string;
  updatedAt: string;
}

export interface ListContainerDocumentsResponse {
  hasMore: boolean;
  items: ContainerDocumentSummary[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentSyncTombstone[];
}

function isContainerDocumentSummary(
  value: unknown,
): value is ContainerDocumentSummary {
  const referencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipals")
    : undefined;
  const currentAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "currentAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    typeof currentAccessStateHash === "string" &&
    currentAccessStateHash.length > 0 &&
    isEffectiveAccessLevel(Reflect.get(value, "effectiveAccessLevel")) &&
    hasStringProperty(value, "id") &&
    hasArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.every((entry) => typeof entry === "string") &&
    hasStringProperty(value, "updatedAt") &&
    Array.isArray(referencedPrincipals) &&
    referencedPrincipals.every(isReferencedPrincipalStateResponse)
  );
}

function isContainerDocumentSyncTombstone(
  value: unknown,
): value is ContainerDocumentSyncTombstone {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "updatedAt")
  );
}

export interface DocumentEditAttributionSegmentResponse {
  peerId: string;
  startCounter: number;
  endCounter: number;
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

export interface DocumentEditAttributionRangeResponse
  extends DocumentEditAttributionSegmentResponse {
  updateId: string;
}

export interface DocumentEditAttributionResponse {
  attributionRevision: number;
  documentId: string;
  segments: DocumentEditAttributionSegmentResponse[];
  /** True when the compact interval list hit the API response safety limit. */
  truncated?: boolean;
}

export interface ListDocumentEditAttributionRangesResponse {
  attributionRevision: number;
  documentId: string;
  hasMore: boolean;
  items: DocumentEditAttributionRangeResponse[];
  nextCursor: string | null;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDocumentEditAttributionSegmentResponse(
  value: unknown,
): value is DocumentEditAttributionSegmentResponse {
  const authorityKind = isPlainObject(value)
    ? Reflect.get(value, "authorityKind")
    : undefined;
  const startCounter = isPlainObject(value)
    ? Reflect.get(value, "startCounter")
    : undefined;
  const endCounter = isPlainObject(value)
    ? Reflect.get(value, "endCounter")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "peerId") &&
    value.peerId.length > 0 &&
    isNonnegativeSafeInteger(startCounter) &&
    isNonnegativeSafeInteger(endCounter) &&
    startCounter < endCounter &&
    hasStringProperty(value, "writerUserId") &&
    value.writerUserId.length > 0 &&
    hasStringProperty(value, "writerKeyFingerprint") &&
    value.writerKeyFingerprint.length > 0 &&
    (authorityKind === "direct" || authorityKind === "baseline")
  );
}

function isDocumentEditAttributionRangeResponse(
  value: unknown,
): value is DocumentEditAttributionRangeResponse {
  const updateId = isPlainObject(value)
    ? Reflect.get(value, "updateId")
    : undefined;
  return (
    isDocumentEditAttributionSegmentResponse(value) &&
    typeof updateId === "string" &&
    updateId.length > 0
  );
}

export function isDocumentEditAttributionResponse(
  value: unknown,
): value is DocumentEditAttributionResponse {
  const truncated = isPlainObject(value)
    ? Reflect.get(value, "truncated")
    : undefined;
  return (
    isPlainObject(value) &&
    isNonnegativeSafeInteger(Reflect.get(value, "attributionRevision")) &&
    hasStringProperty(value, "documentId") &&
    value.documentId.length > 0 &&
    hasArrayProperty(value, "segments") &&
    value.segments.every(isDocumentEditAttributionSegmentResponse) &&
    (truncated === undefined || typeof truncated === "boolean")
  );
}

export function isListDocumentEditAttributionRangesResponse(
  value: unknown,
): value is ListDocumentEditAttributionRangesResponse {
  const attributionRevision = isPlainObject(value)
    ? Reflect.get(value, "attributionRevision")
    : undefined;
  const nextCursor = isPlainObject(value)
    ? Reflect.get(value, "nextCursor")
    : undefined;
  const hasMore = isPlainObject(value)
    ? Reflect.get(value, "hasMore")
    : undefined;

  return (
    isPlainObject(value) &&
    isNonnegativeSafeInteger(attributionRevision) &&
    hasStringProperty(value, "documentId") &&
    value.documentId.length > 0 &&
    typeof hasMore === "boolean" &&
    hasArrayProperty(value, "items") &&
    value.items.length <= 500 &&
    value.items.every(isDocumentEditAttributionRangeResponse) &&
    (hasMore
      ? typeof nextCursor === "string" && nextCursor.length > 0
      : nextCursor === null)
  );
}

export function isListContainerDocumentsResponse(
  value: unknown,
): value is ListContainerDocumentsResponse {
  const nextWatermark = isPlainObject(value)
    ? Reflect.get(value, "nextWatermark")
    : undefined;

  return (
    isPlainObject(value) &&
    typeof Reflect.get(value, "hasMore") === "boolean" &&
    hasArrayProperty(value, "items") &&
    value.items.every(isContainerDocumentSummary) &&
    (isSyncWatermark(nextWatermark) || nextWatermark === null) &&
    hasArrayProperty(value, "tombstones") &&
    value.tombstones.every(isContainerDocumentSyncTombstone)
  );
}
