import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import {
  getAccessManifestBundles,
  getCurrentAccessManifestHeads,
} from "../../../../access/read/accessManifestStore";
import { assertContainerPathEdges } from "../../../containers/mutations";
import { loadContainerManifestBundleByHash } from "../../../containers/writerProjection/accessPaths";
import { createContainerWriterProjectionContext } from "../../../containers/writerProjection/context";
import { toManifestBundleResponse } from "../../../containers/writerProjection/records";
import { verifyStoredContainerManifest } from "../../../containers/writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../../containers/writerProjection/types";
import { DocumentMutationError, documentSyncStateStale } from "../errors";

/**
 * Resolve a flat list of {containerId, manifestHash} references to verified
 * container access manifests using the server's own stored bundles (never
 * client-supplied bytes), with the same current-head pin the full-bundle path
 * enforces. Stored bytes are re-verified here because database contents are not
 * a trust boundary.
 *
 * Resolution is batched into one bundle fetch and one head fetch for the whole
 * request rather than two roundtrips per reference. Order is preserved.
 */
async function resolveCurrentContainerManifestRefs(
  executor: DatabaseSession,
  flatRefs: readonly {
    readonly ref: ContainerManifestRef;
    readonly refLabel: string;
  }[],
): Promise<VerifiedContainerAccessManifest[]> {
  // Resolve every referenced manifest from storage in one batch.
  const storedBundles = await getAccessManifestBundles(
    flatRefs.map(({ ref }) => ref.manifestHash),
    executor,
  );

  const context = createContainerWriterProjectionContext(executor);
  const resolved: {
    readonly manifest: VerifiedContainerAccessManifest;
    readonly refLabel: string;
  }[] = [];
  for (const { ref, refLabel } of flatRefs) {
    const stored = storedBundles.get(ref.manifestHash);
    if (!stored || stored.manifest.objectKind !== "container") {
      // 409, not 404 — a document-route 404 is the client's wipe signal.
      throw new DocumentMutationError(`${refLabel} head missing`, 409);
    }

    let manifest: VerifiedContainerAccessManifest;
    try {
      manifest = await verifyStoredContainerManifest({
        bundle: toManifestBundleResponse(stored),
        context,
        loadBundle: (manifestHash) =>
          loadContainerManifestBundleByHash(context, manifestHash),
      });
    } catch (error) {
      if (error instanceof ContainerWriterProjectionError) {
        throw new DocumentMutationError(error.message, 409);
      }
      throw error;
    }

    // The client-supplied containerId is advisory; reject a confused reference
    // before the current-head lookup authorizes against another container.
    if (ref.containerId !== manifest.state.containerId) {
      throw new DocumentMutationError(
        `${refLabel} container id does not match the referenced manifest`,
        400,
      );
    }
    resolved.push({ manifest, refLabel });
  }

  // Freshness pin — identical in strength to the full-bundle path
  // (assertCurrentContainerPath). Without it a writer could replay a
  // stale-but-stored manifest hash from an epoch in which they held
  // since-revoked access (privilege escalation). Batched into one head fetch.
  const heads = await getCurrentAccessManifestHeads(
    "container",
    resolved.map(({ manifest }) => manifest.state.containerId),
    executor,
  );

  return resolved.map(({ manifest, refLabel }) => {
    const head = heads.get(manifest.state.containerId);
    if (!head) {
      throw new DocumentMutationError(`${refLabel} head missing`, 409);
    }
    if (head.manifestHash !== manifest.manifestHash) {
      throw documentSyncStateStale(`${refLabel} is stale`);
    }
    return manifest;
  });
}

/**
 * Resolve groups of container manifest references (an authorizing-paths set).
 */
export async function assertCurrentContainerPathRefGroups(
  executor: DatabaseSession,
  groups: readonly (readonly ContainerManifestRef[])[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[][] | undefined> {
  if (groups === undefined) {
    return undefined;
  }

  const flatRefs = groups.flatMap((group, groupIndex) =>
    group.map((ref, index) => ({
      ref,
      refLabel: `${label}[${groupIndex}][${index}]`,
    })),
  );

  const verifiedFlat = await resolveCurrentContainerManifestRefs(
    executor,
    flatRefs,
  );

  // Reshape the flat verified manifests back into the original group structure.
  const verifiedGroups: VerifiedContainerAccessManifest[][] = [];
  let cursor = 0;
  for (const group of groups) {
    const path = verifiedFlat.slice(cursor, cursor + group.length);
    assertContainerPathEdges(path, `${label}[${verifiedGroups.length}]`);
    verifiedGroups.push(path);
    cursor += group.length;
  }

  return verifiedGroups;
}

/**
 * Single-path variant of assertCurrentContainerPathRefGroups (same store
 * resolution, containerId check, and head pin) for endpoints whose authorizing
 * path is a single container chain, e.g. a create/link-set targetContainerPath.
 */
export async function assertCurrentContainerPathRefs(
  executor: DatabaseSession,
  refs: readonly ContainerManifestRef[] | undefined,
  label: string,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (refs === undefined) {
    return undefined;
  }
  const path = await resolveCurrentContainerManifestRefs(
    executor,
    refs.map((ref, index) => ({ ref, refLabel: `${label}[${index}]` })),
  );
  assertContainerPathEdges(path, label);
  return path;
}
