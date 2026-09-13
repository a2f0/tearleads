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
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

/** Authenticate immutable destination roles without advancing write-authority pins. */
export async function verifyContainerDestinationProjection(input: {
  readonly execSql: ExecSql;
  readonly projection: ContainerWriterProjectionResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies: ReferencedPrincipalPolicyWarmer;
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
  const path = await verifyContainerManifestPath({
    authorizationMembership: "referenced",
    bundlesByHash,
    checkpointContext: createProjectionCheckpointContext({
      execSql: input.execSql,
      organizationId: input.projection.organizationId,
    }),
    enforceLocalCheckpoints: false,
    servedAsCurrent: false,
    label: "Container destination",
    path: input.projection.path,
    principalPolicyCache: new Map(),
    resolveUserKey: input.resolveUserKey,
    verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return { path, verifiedByHash };
}

/**
 * Walk a verified head back to its epoch-1 `container.create`. Head
 * verification already verified every predecessor it cites (a head is only
 * accepted once its previous manifest verified), so the lineage is present in
 * `verifiedByHash`; a gap means the served projection was incomplete.
 */
export function verifiedContainerCreateManifest(input: {
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest {
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
  return current;
}
