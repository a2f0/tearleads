import type { AccessManifestBundleWireResponse } from "../util";
import {
  type ContainerKeyingPathResponse,
  type ContainerKeyingPathWireResponse,
  type ContainerWriterProjectionResponse,
  type ContainerWriterProjectionWireResponse,
  ContainerWriterProjectionWireResponseSchema,
} from "./container";
import {
  type DocumentWriterProjectionResponse,
  type DocumentWriterProjectionWireResponse,
  DocumentWriterProjectionWireResponseSchema,
} from "./documentMutation";

type Bundle = AccessManifestBundleWireResponse;

/**
 * Collects each distinct manifest once. Every slot a server fills for one
 * hash comes from the same stored row, and the client verifies the bundle it
 * receives wherever that hash is cited, so the first occurrence stands.
 */
function bundleCitations() {
  const byHash = new Map<string, Bundle>();
  return {
    cite(bundle: Bundle): string {
      if (!byHash.has(bundle.manifestHash)) {
        byHash.set(bundle.manifestHash, bundle);
      }
      return bundle.manifestHash;
    },
    // fromEntries defines own data properties, even for a "__proto__" key.
    bundles: (): Record<string, Bundle> => Object.fromEntries(byHash),
  };
}

function encodeKeyingPath(
  path: ContainerKeyingPathResponse,
  cite: (bundle: Bundle) => string,
): ContainerKeyingPathWireResponse {
  return {
    ...path,
    path: path.path.map(cite),
    containerKeks: path.containerKeks.map((kek) => ({
      ...kek,
      containerManifestHistory: kek.containerManifestHistory.map(cite),
    })),
  };
}

export function encodeContainerWriterProjection(
  projection: ContainerWriterProjectionResponse,
): ContainerWriterProjectionWireResponse {
  const citations = bundleCitations();
  const encoded = encodeKeyingPath(projection, citations.cite);
  return { ...projection, ...encoded, bundles: citations.bundles() };
}

export function encodeDocumentWriterProjection(
  projection: DocumentWriterProjectionResponse,
): DocumentWriterProjectionWireResponse {
  const { cite, bundles } = bundleCitations();
  const authorizingContainerPaths = projection.authorizingContainerPaths.map(
    (path) => encodeKeyingPath(path, cite),
  );
  return {
    ...projection,
    authorizingContainerPaths,
    documentContainerManifestHistory:
      projection.documentContainerManifestHistory.map(cite),
    documentManifest: cite(projection.documentManifest),
    documentManifestContainerPaths:
      projection.documentManifestContainerPaths.map((path) => path.map(cite)),
    documentManifestHistory: projection.documentManifestHistory.map(cite),
    bundles: bundles(),
  };
}

/**
 * Each cited position receives its own copy, as when every slot carried its
 * own JSON: a consumer that edits one position cannot change another.
 */
function bundleResolver(bundles: Record<string, Bundle>) {
  const byHash = new Map(Object.entries(bundles));
  return (hash: string): Bundle => {
    const bundle = byHash.get(hash);
    if (!bundle) {
      throw new Error(`manifest ${hash} is cited without a bundle`);
    }
    return structuredClone(bundle);
  };
}

function decodeKeyingPath(
  path: ContainerKeyingPathWireResponse,
  resolve: (hash: string) => Bundle,
): ContainerKeyingPathResponse {
  return {
    ...path,
    path: path.path.map(resolve),
    containerKeks: path.containerKeks.map((kek) => ({
      ...kek,
      containerManifestHistory: kek.containerManifestHistory.map(resolve),
    })),
  };
}

/** Null for any wire inconsistency; the caller treats it as a shape failure. */
export function decodeContainerWriterProjection(
  value: unknown,
): ContainerWriterProjectionResponse | null {
  const parsed = ContainerWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, ...projection } = parsed.data;
  return {
    ...projection,
    ...decodeKeyingPath(projection, bundleResolver(bundles)),
  };
}

/** Null for any wire inconsistency; the caller treats it as a shape failure. */
export function decodeDocumentWriterProjection(
  value: unknown,
): DocumentWriterProjectionResponse | null {
  const parsed = DocumentWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles);
  return {
    ...projection,
    authorizingContainerPaths: projection.authorizingContainerPaths.map(
      (path) => decodeKeyingPath(path, resolve),
    ),
    documentContainerManifestHistory:
      projection.documentContainerManifestHistory.map(resolve),
    documentManifest: resolve(projection.documentManifest),
    documentManifestContainerPaths:
      projection.documentManifestContainerPaths.map((path) =>
        path.map(resolve),
      ),
    documentManifestHistory: projection.documentManifestHistory.map(resolve),
  };
}
