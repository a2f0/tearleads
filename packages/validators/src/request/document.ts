import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";
import {
  AccessManifestBundleWireSchema,
  hasStringProperty,
  MAX_INLINE_CONTAINER_REKEYS,
} from "../util";
import {
  type ContainerMutationRequest,
  ContainerMutationRequestSchema,
  isOptionalContainerMutationRequestArray,
} from "./container";
import {
  ContainerManifestPathSchema,
  type ContainerManifestRef,
  ContainerManifestRefArrayArraySchema,
  type DocumentContentKeyBundleRequest,
  DocumentContentKeyBundleRequestSchema,
  type DocumentOutgoingUpdate,
  DocumentOutgoingUpdateSchema,
  type DocumentSyncRequest,
  DocumentSyncRequestSchema,
} from "./documentSyncSchema";

export {
  type ContainerManifestRef,
  ContainerManifestRefArrayArraySchema,
  ContainerManifestRefSchema,
  type DocumentContentKeyBundleRequest,
  DocumentContentKeyBundleRequestSchema,
  type DocumentContentKeyTargetEnvelope,
  DocumentContentKeyTargetEnvelopeSchema,
  type DocumentOutgoingUpdate,
  DocumentOutgoingUpdateSchema,
  type DocumentSyncRequest,
  DocumentSyncRequestSchema,
} from "./documentSyncSchema";

export const documentCreateRequestShape = {
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema.optional(),
  body: requiredUnknownSchema,
  containerRekeys: arraySchema(
    ContainerMutationRequestSchema,
    MAX_INLINE_CONTAINER_REKEYS,
  ).optional(),
  contentKeyBundle: DocumentContentKeyBundleRequestSchema,
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  manifest: plainObjectSchema,
  previousManifest: AccessManifestBundleWireSchema.nullable().optional(),
  targetContainerPathRefs: ContainerManifestPathSchema.optional(),
} satisfies z.ZodRawShape;

export const DocumentCreateRequestSchema = loosePlainObject(
  documentCreateRequestShape,
);

export type DocumentCreateRequest = z.infer<typeof DocumentCreateRequestSchema>;

export interface DocumentLinkSetMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  // The prior link-set manifest is the document's current head; the server
  // resolves it from its own store (the signed event's previousManifestHash pins
  // freshness), so the writer no longer echoes the bundle back.
  // Container access manifests authorizing the write, as hash references the
  // server resolves from its own store.
  targetContainerPathRefs: ContainerManifestRef[];
  authorizingContainerPathRefs: ContainerManifestRef[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: DocumentContentKeyBundleRequest;
  rotationBaseline?: DocumentOutgoingUpdate;
}

function isContainerManifestRef(value: unknown): value is ContainerManifestRef {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    value.containerId.length > 0 &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0
  );
}

// A container path (root→leaf chain) must carry at least one manifest
// reference; an empty path authorizes nothing and is never legitimately built.
function isContainerManifestRefArray(
  value: unknown,
): value is ContainerManifestRef[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isContainerManifestRef)
  );
}

export function isContainerManifestRefArrayArray(
  value: unknown,
): value is ContainerManifestRef[][] {
  return ContainerManifestRefArrayArraySchema.safeParse(value).success;
}

export function isDocumentContentKeyBundleRequest(
  value: unknown,
): value is DocumentContentKeyBundleRequest {
  return DocumentContentKeyBundleRequestSchema.safeParse(value).success;
}

function isDocumentOutgoingUpdate(
  value: unknown,
): value is DocumentOutgoingUpdate {
  return DocumentOutgoingUpdateSchema.safeParse(value).success;
}

export function isDocumentCreateRequest(
  value: unknown,
): value is DocumentCreateRequest {
  return DocumentCreateRequestSchema.safeParse(value).success;
}

export function isDocumentLinkSetMutationRequest(
  value: unknown,
): value is DocumentLinkSetMutationRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const targetContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "targetContainerPathRefs")
    : undefined;
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
    : undefined;
  const rotationBaseline = isPlainObject(value)
    ? Reflect.get(value, "rotationBaseline")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "expectedManifestHash") &&
    value.expectedManifestHash.length > 0 &&
    isPlainObject(manifest) &&
    isContainerManifestRefArray(targetContainerPathRefs) &&
    isContainerManifestRefArrayArray(authorizingContainerPathRefs) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    isDocumentContentKeyBundleRequest(contentKeyBundle) &&
    (rotationBaseline === undefined ||
      isDocumentOutgoingUpdate(rotationBaseline))
  );
}

export function isDocumentSyncRequest(
  value: unknown,
): value is DocumentSyncRequest {
  return DocumentSyncRequestSchema.safeParse(value).success;
}
