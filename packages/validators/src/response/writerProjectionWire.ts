import type { AccessManifestBundleWireResponse } from "../util";
import {
  type ContainerKekResponse,
  type ContainerKekWireLevel,
  type ContainerKeyingPathResponse,
  type ContainerKeyingPathWireResponse,
  type ContainerWriterProjectionResponse,
  type ContainerWriterProjectionWireResponse,
  ContainerWriterProjectionWireResponseSchema,
  isCitedContainerKekLevel,
} from "./container";
import {
  type DocumentWriterProjectionResponse,
  type DocumentWriterProjectionWireResponse,
  DocumentWriterProjectionWireResponseSchema,
} from "./documentMutation";

type Bundle = AccessManifestBundleWireResponse;
type HeldLevels = ReadonlyMap<string, ContainerKekWireLevel>;

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

/** A KEK level's wire form: its manifest history cited by hash. */
export function containerKekWireLevel(
  kek: ContainerKekResponse,
): ContainerKekWireLevel {
  return {
    ...kek,
    containerManifestHistory: kek.containerManifestHistory.map(
      (bundle) => bundle.manifestHash,
    ),
  };
}

/**
 * The digest a request declared for a KEK level it holds, or null when the
 * level travels in full. The caller derives it from the level's own served
 * bytes, so a level is omitted only when the held copy is exactly these.
 */
export type HeldKekLevelDigest = (kek: ContainerKekResponse) => string | null;

function encodeKeyingPath(
  path: ContainerKeyingPathResponse,
  cite: (bundle: Bundle) => string,
  heldLevel: HeldKekLevelDigest,
): ContainerKeyingPathWireResponse {
  return {
    ...path,
    path: path.path.map(cite),
    containerKeks: path.containerKeks.map((kek) => {
      const level = {
        ...kek,
        containerManifestHistory: kek.containerManifestHistory.map(cite),
      };
      const levelDigest = heldLevel(kek);
      return levelDigest === null
        ? level
        : {
            levelDigest,
            containerManifestHistory: level.containerManifestHistory,
          };
    }),
  };
}

const noHeldLevels: HeldKekLevelDigest = () => null;

/**
 * Call only after authorization and stored-evidence verification. `known`
 * holds the request's manifest hints; only hashes this projection cites are
 * omitted. `heldLevel` names each KEK level the request holds exactly.
 */
export function encodeContainerWriterProjection(
  projection: ContainerWriterProjectionResponse,
  known: ReadonlySet<string> = new Set(),
  heldLevel: HeldKekLevelDigest = noHeldLevels,
): ContainerWriterProjectionWireResponse {
  const citations = bundleCitations(known);
  const encoded = encodeKeyingPath(projection, citations.cite, heldLevel);
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
  heldLevel: HeldKekLevelDigest = noHeldLevels,
): DocumentWriterProjectionWireResponse {
  const { cite, bundles, omitted } = bundleCitations(known);
  const authorizingContainerPaths = projection.authorizingContainerPaths.map(
    (path) => encodeKeyingPath(path, cite, heldLevel),
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

function sameHashes(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((hash, index) => hash === right[index])
  );
}

/**
 * Each cited KEK level becomes its own copy of the exact held level this
 * request declared under that digest. A digest the request did not cite, or
 * a held level whose manifest citations differ from the stub's, makes the
 * path unusable: the caller refetches in full.
 */
function fillKekLevels(
  path: ContainerKeyingPathWireResponse,
  heldLevels: HeldLevels,
): ContainerKekWireLevel[] | null {
  const levels: ContainerKekWireLevel[] = [];
  for (const kek of path.containerKeks) {
    if (!isCitedContainerKekLevel(kek)) {
      levels.push(kek);
      continue;
    }
    const held = heldLevels.get(kek.levelDigest);
    if (
      !held ||
      !sameHashes(held.containerManifestHistory, kek.containerManifestHistory)
    )
      return null;
    levels.push(structuredClone(held));
  }
  return levels;
}

function decodeKeyingPath(
  path: ContainerKeyingPathWireResponse,
  resolve: (hash: string) => Bundle,
  heldLevels: HeldLevels,
): ContainerKeyingPathResponse | null {
  const levels = fillKekLevels(path, heldLevels);
  if (!levels) return null;
  return {
    ...path,
    path: path.path.map(resolve),
    containerKeks: levels.map((kek) => ({
      ...kek,
      containerManifestHistory: kek.containerManifestHistory.map(resolve),
    })),
  };
}

/**
 * Null for any wire inconsistency or an omission `held` (bundles) or
 * `heldLevels` (KEK levels by digest) cannot fill; the caller treats either
 * as a shape failure.
 */
export function decodeContainerWriterProjection(
  value: unknown,
  held: ReadonlyMap<string, Bundle> = new Map(),
  heldLevels: HeldLevels = new Map(),
): ContainerWriterProjectionResponse | null {
  const parsed = ContainerWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, omittedBundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles, omittedBundles, held);
  const path = resolve
    ? decodeKeyingPath(projection, resolve, heldLevels)
    : null;
  return path ? { ...projection, ...path } : null;
}

/** See {@link decodeContainerWriterProjection}. */
export function decodeDocumentWriterProjection(
  value: unknown,
  held: ReadonlyMap<string, Bundle> = new Map(),
  heldLevels: HeldLevels = new Map(),
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
  const authorizingContainerPaths: ContainerKeyingPathResponse[] = [];
  for (const path of projection.authorizingContainerPaths) {
    const decoded = decodeKeyingPath(path, resolve, heldLevels);
    if (!decoded) return null;
    authorizingContainerPaths.push(decoded);
  }
  const [firstPath, ...otherPaths] = authorizingContainerPaths;
  if (!firstPath) return null;
  return {
    ...projection,
    authorizingContainerPaths: [firstPath, ...otherPaths],
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
