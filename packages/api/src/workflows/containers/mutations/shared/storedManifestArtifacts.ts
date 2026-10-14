import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import {
  loadContainerManifestBundleByHash,
  prefetchContainerManifestHistory,
} from "../../writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError, mutationShapeError } from "../errors";
import type { ContainerMutationContext } from "../types";

function assertReferencedContainer(
  ref: ContainerManifestRef,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): VerifiedContainerAccessManifest {
  // The cited containerId is advisory; reject a confused reference before any
  // head lookup authorizes against a container the request did not name.
  if (manifest.state.containerId !== ref.containerId) {
    throw new ContainerMutationError(
      `${label} container id does not match the referenced manifest`,
      409,
    );
  }
  return manifest;
}

/**
 * Resolve a cited container manifest from the server's own artifacts, never
 * from request bytes: first a manifest an earlier mutation of this batch
 * verified, then the stored bundle, which is re-verified because database
 * contents are not a trust boundary. Callers still pin the result to the
 * current head where freshness matters.
 */
export async function resolveVerifiedStoredContainerManifest(
  context: ContainerMutationContext,
  ref: ContainerManifestRef,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const batchManifest = context.verifiedManifestByHash.get(ref.manifestHash);
  if (batchManifest) {
    return assertReferencedContainer(ref, batchManifest, label);
  }
  try {
    const storedBundle = await loadContainerManifestBundleByHash(
      context.writerProjectionContext,
      ref.manifestHash,
    );
    const storedManifest = await verifyStoredContainerManifest({
      bundle: storedBundle,
      context: context.writerProjectionContext,
      loadBundle: (manifestHash) =>
        loadContainerManifestBundleByHash(
          context.writerProjectionContext,
          manifestHash,
        ),
    });
    return assertReferencedContainer(ref, storedManifest, label);
  } catch (error) {
    if (!(error instanceof ContainerWriterProjectionError)) {
      throw error;
    }
    throw new ContainerMutationError(
      `${label} is not a verified stored manifest: ${error.message}`,
      409,
    );
  }
}

/**
 * Refuse a citation list that repeats a manifest before reading any of it: a
 * path visits each container once and KEK verification rejects a duplicate
 * history entry, so a repeat is malformed rather than work to dedupe.
 */
export function assertDistinctManifestRefs(
  refs: readonly ContainerManifestRef[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const [index, ref] of refs.entries()) {
    if (seen.has(ref.manifestHash)) {
      throw mutationShapeError(`${label}[${index}] repeats a cited manifest`);
    }
    seen.add(ref.manifestHash);
  }
}

const HISTORY_LABEL = "containerManifestHistoryRefs";

/**
 * Resolve the cited lineage of the container a mutation advances. Every entry
 * must be that container's manifest (KEK verification refuses any other), so
 * each citation is checked against it before any read, and the lineage loads
 * in one bulk query: a long history costs one read, not one per entry.
 */
export async function resolveCitedContainerHistory(
  context: ContainerMutationContext,
  refs: readonly ContainerManifestRef[] | undefined,
  previousManifest: VerifiedContainerAccessManifest | null,
): Promise<VerifiedContainerAccessManifest[] | undefined> {
  if (refs === undefined) {
    return;
  }
  assertDistinctManifestRefs(refs, HISTORY_LABEL);
  if (refs.length === 0) {
    return [];
  }
  if (!previousManifest) {
    throw mutationShapeError(`${HISTORY_LABEL} requires previousManifestRef`);
  }
  const { containerId } = previousManifest.state;
  for (const [index, ref] of refs.entries()) {
    if (ref.containerId !== containerId) {
      throw mutationShapeError(
        `${HISTORY_LABEL}[${index}] cites another container`,
      );
    }
  }
  await prefetchContainerManifestHistory(
    context.writerProjectionContext,
    containerId,
  );
  const manifests: VerifiedContainerAccessManifest[] = [];
  for (const [index, ref] of refs.entries()) {
    manifests.push(
      await resolveVerifiedStoredContainerManifest(
        context,
        ref,
        `${HISTORY_LABEL}[${index}]`,
      ),
    );
  }
  return manifests;
}
