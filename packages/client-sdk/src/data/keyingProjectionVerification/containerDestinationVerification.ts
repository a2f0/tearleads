import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../sqlite/sqlSchema";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { addContainerWriterProjectionBundles } from "./containerProjectionVerification";
import { verifyProjectionAuthorizationEvidence } from "./projectionAuthorizationEvidence";
import type { ProjectionUserKeyResolver } from "./types";

/** Authenticate immutable destination roles without advancing write-authority pins. */
export async function verifyContainerDestinationProjection(input: {
  readonly execSql: ExecSql;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<{
  readonly path: VerifiedContainerAccessManifest[];
  /** Every manifest verified on the way, including each head's lineage. */
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}> {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addContainerWriterProjectionBundles(
    bundlesByHash,
    input.projection,
    "Container destination",
  );
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const checkpointContext = createProjectionCheckpointContext({
    execSql: input.execSql,
    organizationId: input.projection.organizationId,
  });
  const principalPolicyCache = new Map();
  const authorizationEvidence = await verifyProjectionAuthorizationEvidence({
    bundles: [...bundlesByHash.values()],
    checkpointContext,
    policyEvidence: input.projection.policyEvidence,
    organizationId: input.projection.organizationId,
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
  });
  const path = await verifyContainerManifestPath({
    authorizationEvidence,
    requireAuthorizationEvidence: true,
    authorizationMembership: "referenced",
    bundlesByHash,
    checkpointContext,
    enforceLocalCheckpoints: false,
    servedAsCurrent: false,
    label: "Container destination",
    path: input.projection.path,
    principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
  });
  return { path, verifiedByHash };
}

/**
 * Walk a verified head back to its epoch-1 `container.create`, returning the
 * lineage head first. Head verification already verified every predecessor it
 * cites (a head is only accepted once its previous manifest verified), so the
 * lineage is present in `verifiedByHash`; a gap means the served projection
 * was incomplete.
 */
export function verifiedContainerLineage(input: {
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest[] {
  const lineage = [input.head];
  let current = input.head;
  const visited = new Set<string>();
  while (current.state.previousManifestHash !== null) {
    if (visited.has(current.manifestHash)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${input.label} manifest lineage is cyclic`,
      );
    }
    visited.add(current.manifestHash);
    const previous = input.verifiedByHash.get(
      current.state.previousManifestHash,
    );
    if (!previous || previous.state.containerId !== current.state.containerId) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${input.label} lineage does not reach its container.create`,
      );
    }
    current = previous;
    lineage.push(current);
  }
  if (
    current.state.epoch !== 1 ||
    current.event.event.eventType !== "container.create"
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${input.label} lineage does not start with container.create`,
    );
  }
  return lineage;
}

/** The epoch-1 `container.create` a verified head descends from. */
export function verifiedContainerCreateManifest(input: {
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest {
  const lineage = verifiedContainerLineage(input);
  const create = lineage.at(-1);
  if (!create) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} lineage is empty`,
    );
  }
  return create;
}
