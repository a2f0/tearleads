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
  readonly chains: readonly {
    readonly key: string;
    readonly values: unknown[];
  }[];
}

function manifestEpoch(bundle: AccessManifestBundleWireResponse): number {
  const epoch: unknown = Reflect.get(bundle.manifest, "epoch");
  return typeof epoch === "number" && Number.isFinite(epoch) ? epoch : 0;
}

/** Only these evidence arrays can be omitted. Current heads and keys always travel. */
export function projectionHistoryArrays(
  projection: HistoryProjection,
): ProjectionHistoryArray[] {
  const arrays: ProjectionHistoryArray[] = [];
  const identity =
    "containerId" in projection
      ? ["container", projection.organizationId, projection.containerId]
      : [
          "document",
          Reflect.get(projection.documentManifest.manifest, "organizationId"),
          projection.documentId,
        ];
  const add = (name: string, values: unknown[]) => {
    const key = JSON.stringify([...identity, name]);
    arrays.push({ key, values, chains: [{ key, values }] });
  };
  const manifests = (
    name: string,
    values: AccessManifestBundleWireResponse[],
  ) => {
    const key = JSON.stringify([...identity, name]);
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
    arrays.push({
      key,
      values,
      chains: [...groups].map(([chain, entries]) => ({
        key: chain,
        values: entries.sort(
          (a, b) =>
            manifestEpoch(a) - manifestEpoch(b) ||
            compareCanonicalStrings(a.manifestHash, b.manifestHash),
        ),
      })),
    });
  };
  const path = (name: string, value: ContainerKeyingPathResponse) => {
    for (const [index, kek] of value.containerKeks.entries())
      manifests(
        `${name}:kek:${index}:${kek.containerId}`,
        kek.containerManifestHistory,
      );
  };
  const evidence = projection.policyEvidence;
  if (evidence.organization)
    add(
      `organization:${evidence.organization.currentState.principalId}`,
      evidence.organization.previousStates,
    );
  for (const group of evidence.groups)
    add(`group:${group.currentState.principalId}`, group.previousStates);
  add("organizationPayloads", evidence.organizationPayloads);
  if ("containerId" in projection) path("container", projection);
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
    manifests("documentManifestHistory", projection.documentManifestHistory);
  }
  return arrays;
}
