import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
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
