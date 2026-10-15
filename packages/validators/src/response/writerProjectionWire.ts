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
 * receives wherever that hash is cited, so the first occurrence stands. A
 * hash the request declared known is cited but not served.
 */
function bundleCitations(known: ReadonlySet<string>) {
  const byHash = new Map<string, Bundle>();
  const omitted = new Set<string>();
  return {
    cite(bundle: Bundle): string {
      const hash = bundle.manifestHash;
      if (known.has(hash)) omitted.add(hash);
      else if (!byHash.has(hash)) byHash.set(hash, bundle);
      return hash;
    },
    // fromEntries defines own data properties, even for a "__proto__" key.
    bundles: (): Record<string, Bundle> => Object.fromEntries(byHash),
    omitted: (): string[] => [...omitted],
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

/**
 * Call only after authorization and stored-evidence verification. `known`
 * holds the request's hints; only hashes this projection cites are omitted.
 */
export function encodeContainerWriterProjection(
  projection: ContainerWriterProjectionResponse,
  known: ReadonlySet<string> = new Set(),
): ContainerWriterProjectionWireResponse {
  const citations = bundleCitations(known);
  const encoded = encodeKeyingPath(projection, citations.cite);
  return {
    ...projection,
    ...encoded,
    bundles: citations.bundles(),
    omittedBundles: citations.omitted(),
  };
}

/** See {@link encodeContainerWriterProjection}. */
export function encodeDocumentWriterProjection(
  projection: DocumentWriterProjectionResponse,
  known: ReadonlySet<string> = new Set(),
): DocumentWriterProjectionWireResponse {
  const { cite, bundles, omitted } = bundleCitations(known);
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
    omittedBundles: omitted(),
  };
}

/**
 * Served bundles plus the exact held bytes for each omitted hash. An omission
 * the caller cannot fill from `held` (which carries only what its request
 * cited) makes the response unusable. Each cited position receives its own
 * copy, as when every slot carried its own JSON.
 */
function bundleResolver(
  bundles: Record<string, Bundle>,
  omittedBundles: readonly string[],
  held: ReadonlyMap<string, Bundle>,
): ((hash: string) => Bundle) | null {
  const byHash = new Map(Object.entries(bundles));
  for (const hash of omittedBundles) {
    const bundle = held.get(hash);
    if (bundle?.manifestHash !== hash) return null;
    byHash.set(hash, bundle);
  }
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

/**
 * Null for any wire inconsistency or an omission `held` cannot fill; the
 * caller treats either as a shape failure.
 */
export function decodeContainerWriterProjection(
  value: unknown,
  held: ReadonlyMap<string, Bundle> = new Map(),
): ContainerWriterProjectionResponse | null {
  const parsed = ContainerWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, omittedBundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles, omittedBundles, held);
  return resolve
    ? { ...projection, ...decodeKeyingPath(projection, resolve) }
    : null;
}

/** See {@link decodeContainerWriterProjection}. */
export function decodeDocumentWriterProjection(
  value: unknown,
  held: ReadonlyMap<string, Bundle> = new Map(),
): DocumentWriterProjectionResponse | null {
  const parsed = DocumentWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, omittedBundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles, omittedBundles, held);
  if (!resolve) {
    return null;
  }
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
