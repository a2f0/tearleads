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
  const manifest = readRecord(request.manifest, "manifest");
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
