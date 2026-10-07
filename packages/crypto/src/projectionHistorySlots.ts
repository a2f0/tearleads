import type {
  AccessManifestBundleWireResponse,
  ContainerKeyingPathResponse,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { compareCanonicalStrings } from "./canonicalOrdering";

export type HistoryProjection =
  | ContainerWriterProjectionResponse
  | DocumentWriterProjectionResponse;
export interface ProjectionHistoryArray {
  readonly key: string;
  readonly values: unknown[];
  readonly restoreOrder?: (() => void) | undefined;
  readonly chains: readonly {
    readonly key: string;
    readonly values: unknown[];
  }[];
}

function manifestEpoch(bundle: AccessManifestBundleWireResponse): number {
  const epoch: unknown = Reflect.get(bundle.manifest, "epoch");
  return typeof epoch === "number" && Number.isFinite(epoch) ? epoch : 0;
}

function isDocumentProjection(
  projection: HistoryProjection,
): projection is DocumentWriterProjectionResponse {
  return "documentId" in projection && "documentManifest" in projection;
}

function unambiguousArrays(
  arrays: ProjectionHistoryArray[],
): ProjectionHistoryArray[] {
  const occurrences = new Map<string, number>();
  for (const array of arrays)
    occurrences.set(array.key, (occurrences.get(array.key) ?? 0) + 1);
  // Ambiguous locations cannot safely negotiate an omission. Deliver them full.
  return arrays.filter((array) => occurrences.get(array.key) === 1);
}

function manifestHistoryArray(
  key: string,
  values: AccessManifestBundleWireResponse[],
  newestFirst: boolean,
): ProjectionHistoryArray {
  const groups = new Map<string, AccessManifestBundleWireResponse[]>();
  for (const value of values) {
    const chain = JSON.stringify([
      key,
      Reflect.get(value.manifest, "organizationId"),
      Reflect.get(value.manifest, "objectKind"),
      Reflect.get(value.manifest, "objectId"),
    ]);
    const entries = groups.get(chain) ?? [];
    entries.push(value);
    groups.set(chain, entries);
  }
  return {
    key,
    values,
    restoreOrder: newestFirst
      ? () => {
          values.sort((a, b) => manifestEpoch(b) - manifestEpoch(a));
        }
      : undefined,
    chains: [...groups].map(([chain, entries]) => ({
      key: chain,
      values: entries.sort(
        (a, b) =>
          manifestEpoch(a) - manifestEpoch(b) ||
          compareCanonicalStrings(a.manifestHash, b.manifestHash),
      ),
    })),
  };
}

/** Only these evidence arrays can be omitted. Current heads and keys always travel. */
export function projectionHistoryArrays(
  projection: HistoryProjection,
): ProjectionHistoryArray[] {
  const arrays: ProjectionHistoryArray[] = [];
  const identity = isDocumentProjection(projection)
    ? [
        "document",
        Reflect.get(projection.documentManifest.manifest, "organizationId"),
        projection.documentId,
      ]
    : ["container", projection.organizationId, projection.containerId];
  const add = (name: string, values: unknown[]) => {
    const key = JSON.stringify([...identity, name]);
    arrays.push({ key, values, chains: [{ key, values }] });
  };
  const manifests = (
    name: string,
    values: AccessManifestBundleWireResponse[],
    newestFirst = false,
  ) => {
    const key = JSON.stringify([...identity, name]);
    arrays.push(manifestHistoryArray(key, values, newestFirst));
  };
  const path = (name: string, value: ContainerKeyingPathResponse) => {
    for (const [index, kek] of value.containerKeks.entries())
      manifests(
        `${name}:kek:${index}:${kek.containerId}`,
        kek.containerManifestHistory,
      );
  };
  const evidence = projection.policyEvidence;
  add("organizationPayloads", evidence.organizationPayloads);
  if (!isDocumentProjection(projection)) path("container", projection);
  else {
    for (const [index, value] of projection.authorizingContainerPaths.entries())
      path(`path:${index}:${value.containerId}`, value);
    // A dependency path is ordered root-to-leaf, not an unordered history.
    for (const [
      index,
      values,
    ] of projection.documentManifestContainerPaths.entries())
      add(`documentManifestContainerPaths:${index}`, values);
    manifests(
      "documentContainerManifestHistory",
      projection.documentContainerManifestHistory,
    );
    manifests(
      "documentManifestHistory",
      projection.documentManifestHistory,
      true,
    );
  }
  return unambiguousArrays(arrays);
}
