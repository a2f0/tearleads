import { deriveDocumentLinkSetManifest } from "@tearleads/crypto";
import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import {
  type AccessManifestBundleWireResponse,
  type DocumentContentKeyBundleResponse,
  type DocumentCreateResponse,
  type DocumentKekTargetsResponse,
  type DocumentLinkSetMutationResponse,
  type DocumentWriterProjectionResponse,
  documentKekTargetsFromContentKeyBundle,
} from "@tearleads/validators/response";
import {
  rememberedRequestManifest,
  rememberRequestManifest,
} from "./requestManifests";

/**
 * A document create or link-set acknowledgement plus the committed material a
 * client rebuilds from its own plan: the manifest bundle, content-key bundle,
 * and KEK targets the response no longer echoes. Tests that chain later
 * requests off a create read these as they read the old echo.
 */
export type DocumentMutationFixture<R> = R & {
  readonly accessManifest: AccessManifestBundleWireResponse;
  readonly contentKeyBundle: DocumentContentKeyBundleResponse;
  readonly documentKekTargets: DocumentKekTargetsResponse;
};

export type CreatedDocumentFixture =
  DocumentMutationFixture<DocumentCreateResponse>;
export type LinkedDocumentFixture =
  DocumentMutationFixture<DocumentLinkSetMutationResponse>;

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Document fixture ${label} is not an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** Rebuilds the acknowledged material from the request the test submitted. */
export function withDocumentMutationArtifacts<
  R extends DocumentLinkSetMutationResponse,
>(
  request: DocumentCreateRequest | DocumentLinkSetMutationRequest,
  response: R,
): DocumentMutationFixture<R> {
  const manifest = readRecord(
    "manifest" in request
      ? request.manifest
      : rememberedRequestManifest(request),
    "manifest",
  );
  const event = readRecord(request.event, "event");
  const linkedContainerIds = [
    ...new Set(
      request.contentKeyBundle.targets.map((target) => target.containerId),
    ),
  ].sort();
  const state = {
    version: 1,
    documentId: response.id,
    organizationId: Reflect.get(manifest, "organizationId"),
    epoch: Reflect.get(manifest, "epoch"),
    previousManifestHash:
      Reflect.get(manifest, "previousManifestHash") ??
      Reflect.get(event, "previousManifestHash") ??
      null,
    eventHash: response.eventHash,
    linkedContainerIds,
  };
  const contentKeyBundle: DocumentContentKeyBundleResponse = {
    documentId: response.id,
    contentKeyEpoch: response.contentKeyEpoch,
    linkSetManifestHash: response.manifestHash,
    targetHash: response.targetHash,
    targets: request.contentKeyBundle.targets.map((target) => ({
      ...target,
      wrappingMetadata: readRecord(target.wrappingMetadata, "wrapping"),
    })),
  };
  const kekTargets = documentKekTargetsFromContentKeyBundle({
    ...contentKeyBundle,
    targets: [...contentKeyBundle.targets].sort((left, right) =>
      left.containerId < right.containerId
        ? -1
        : left.containerId > right.containerId
          ? 1
          : 0,
    ),
  });
  return {
    ...response,
    accessManifest: {
      event: { event, body: request.body, eventHash: response.eventHash },
      manifest,
      manifestHash: response.manifestHash,
      state,
    },
    contentKeyBundle,
    documentKekTargets: kekTargets,
  };
}

/** The same material from the writer projection an SDK create returned. */
export function documentFixtureFromWriterProjection<
  R extends DocumentLinkSetMutationResponse,
>(
  response: R,
  writerProjection: DocumentWriterProjectionResponse,
): DocumentMutationFixture<R> {
  return {
    ...response,
    accessManifest: writerProjection.documentManifest,
    contentKeyBundle: writerProjection.contentKeyBundle,
    documentKekTargets: writerProjection.documentKekTargets,
  };
}

/**
 * As {@link withDocumentMutationArtifacts} for a create a client built (such
 * as the SDK's plan), which carries only its manifest hash: the initial
 * link-set manifest is derived from the signed event and the acknowledgement.
 */
export async function withCreatedDocumentArtifacts(
  request: DocumentCreateRequest,
  response: DocumentCreateResponse,
): Promise<CreatedDocumentFixture> {
  if (!rememberedRequestManifest(request)) {
    const { organizationId } = readRecord(request.event, "event");
    const { containerId } = readRecord(request.body, "body");
    rememberRequestManifest(
      request,
      await deriveDocumentLinkSetManifest({
        version: 1,
        documentId: response.id,
        organizationId: String(organizationId),
        epoch: 1,
        previousManifestHash: null,
        eventHash: response.eventHash,
        linkedContainerIds: [String(containerId)],
      }),
    );
  }
  return withDocumentMutationArtifacts(request, response);
}
