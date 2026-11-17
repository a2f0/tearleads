import {
  type AccessManifestBundleWireResponse,
  type ServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "../util";
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
type ServedBundle = ServedAccessManifestBundleWireResponse;
type HeldLevels = ReadonlyMap<string, ContainerKekWireLevel>;

/**
 * Rebuilds the derived state of every served bundle from the signed bodies
 * along its served predecessor chain; null for a bundle it cannot rebuild.
 * The client supplies it, because the rule lives with the verifier.
 */
export type ManifestStateReconstructor = (
  bundles: ReadonlyMap<string, ServedBundle>,
) => ReadonlyMap<string, Record<string, unknown> | null>;

/** What a client decodes a writer projection with. */
export interface WriterProjectionDecoding {
  /** Exact held bytes for each hash the request cited as held. */
  readonly held?: ReadonlyMap<string, ServedBundle> | undefined;
  /** Exact held KEK levels by the digest the request cited. */
  readonly heldLevels?: HeldLevels | undefined;
  readonly reconstructStates: ManifestStateReconstructor;
}

/**
 * Collects each distinct manifest once. Every slot a server fills for one
 * hash comes from the same stored row, and the client verifies the bundle it
 * receives wherever that hash is cited, so the first occurrence stands. A
 * hash the request declared known is cited but not served. A served bundle
 * carries no derived state: the client rebuilds it from the signed bodies.
 */
function bundleCitations(known: ReadonlySet<string>) {
  const byHash = new Map<string, ServedBundle>();
  const omitted = new Set<string>();
  return {
    cite(bundle: Bundle): string {
      const hash = bundle.manifestHash;
      if (known.has(hash)) omitted.add(hash);
      else if (!byHash.has(hash))
        byHash.set(hash, toServedAccessManifestBundle(bundle));
      return hash;
    },
    // fromEntries defines own data properties, even for a "__proto__" key.
    bundles: (): Record<string, ServedBundle> => Object.fromEntries(byHash),
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
 * cited) makes the response unusable. Each bundle gets the state rebuilt
 * from the signed chain; one that cannot be rebuilt gets an empty state,
 * which every reader and the verifier refuse as they would a malformed one.
 * Each cited position receives its own copy, as when every slot carried its
 * own JSON.
 */
function bundleResolver(
  bundles: Record<string, ServedBundle>,
  omittedBundles: readonly string[],
  decoding: WriterProjectionDecoding,
): ((hash: string) => Bundle) | null {
  const byHash = new Map(Object.entries(bundles));
  for (const hash of omittedBundles) {
    const bundle = decoding.held?.get(hash);
    if (bundle?.manifestHash !== hash) return null;
    byHash.set(hash, toServedAccessManifestBundle(bundle));
  }
  const states = decoding.reconstructStates(byHash);
  return (hash: string): Bundle => {
    const bundle = byHash.get(hash);
    if (!bundle) {
      throw new Error(`manifest ${hash} is cited without a bundle`);
    }
    return structuredClone({ ...bundle, state: states.get(hash) ?? {} });
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
  decoding: WriterProjectionDecoding,
): ContainerWriterProjectionResponse | null {
  const parsed = ContainerWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, omittedBundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles, omittedBundles, decoding);
  const path = resolve
    ? decodeKeyingPath(projection, resolve, decoding.heldLevels ?? new Map())
    : null;
  return path ? { ...projection, ...path } : null;
}

/** See {@link decodeContainerWriterProjection}. */
export function decodeDocumentWriterProjection(
  value: unknown,
  decoding: WriterProjectionDecoding,
): DocumentWriterProjectionResponse | null {
  const parsed = DocumentWriterProjectionWireResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { bundles, omittedBundles, ...projection } = parsed.data;
  const resolve = bundleResolver(bundles, omittedBundles, decoding);
  if (!resolve) {
    return null;
  }
  const heldLevels = decoding.heldLevels ?? new Map();
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
