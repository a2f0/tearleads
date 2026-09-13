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
}) {
  const bundlesByHash = new Map<string, AccessManifestBundleWireResponse>();
  addContainerWriterProjectionBundles(
    bundlesByHash,
    input.projection,
    "Container destination",
  );
  return verifyContainerManifestPath({
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
    verifiedByHash: new Map(),
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}
