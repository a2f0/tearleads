import {
  type AnyVerifiedPrincipalPolicy,
  type ContainerAccessLevel,
  KeyingVerificationError,
  requireContainerPathUserAccess,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { assertNewHeadCitesServedAncestors } from "./containerAncestorCitations";
import { verifyContainerManifestBundle } from "./containerManifestVerification";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

interface ContainerManifestPathInput {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoints: boolean;
  readonly label: string;
  readonly path: readonly AccessManifestBundleWireResponse[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly requireAuthorizationEvidence?: boolean | undefined;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

/**
 * The access a container event needs, checked at the served current path
 * instead of the ancestors the event cites: the parent path for a create
 * and for a move's destination, and the container's own previous state
 * beneath its ancestors for a grant, revoke, or rekey, as the manifest
 * verifier checks it at the cited path.
 */
function servedPathAuthorization(
  input: ContainerManifestPathInput,
  head: VerifiedContainerAccessManifest,
  label: string,
  servedAncestors: readonly VerifiedContainerAccessManifest[],
): () => Promise<void> {
  return async () => {
    const eventType = head.event.event.eventType;
    const ownsPrevious =
      eventType === "container.grant" ||
      eventType === "container.revoke" ||
      eventType === "container.rekey";
    const previousHash = head.state.previousManifestHash;
    const previous =
      previousHash === null
        ? undefined
        : input.verifiedByHash.get(previousHash);
    if (ownsPrevious && !previous) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${label} previous manifest is not verified`,
      );
    }
    const path =
      ownsPrevious && previous
        ? [...servedAncestors, previous]
        : [...servedAncestors];
    const minimumAccessLevel: ContainerAccessLevel =
      eventType === "container.grant" || eventType === "container.revoke"
        ? "admin"
        : "write";
    const principalPolicies = await collectReferencedPrincipalPolicies({
      checkpointContext: input.checkpointContext,
      organizationId: head.state.organizationId,
      principalPolicyCache: input.principalPolicyCache,
      references: path.flatMap(
        (manifest) => manifest.state.referencedPrincipalHeads,
      ),
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    requireContainerPathUserAccess({
      label: `${label} at the served current path`,
      membershipAt: input.authorizationMembership ?? "current",
      minimumAccessLevel,
      path,
      principalPolicies,
      userId: head.event.event.signerUserId,
    });
  };
}

export async function verifyContainerManifestPath(
  input: ContainerManifestPathInput,
): Promise<VerifiedContainerAccessManifest[]> {
  // A checkpoint-enforced path verified at current membership is the current
  // one, which a later event on the container can re-cite, so its elements
  // are held to the served heads above them. A signed snapshot such as a
  // purge's authorizing path is verified at referenced membership: no later
  // event can re-cite it, and the checkpoint check alone bounds it.
  const holdToServedAncestors =
    input.enforceLocalCheckpoints &&
    (input.authorizationMembership ?? "current") === "current";
  const verifiedPath: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of input.path.entries()) {
    const label = `${input.label}[${index}]`;
    const verified = await verifyContainerManifestBundle({
      authorizationMembership: input.authorizationMembership,
      authorizationEvidence: input.authorizationEvidence,
      bundle,
      bundlesByHash: input.bundlesByHash,
      checkpointContext: input.checkpointContext,
      enforceLocalCheckpoint: input.enforceLocalCheckpoints,
      label,
      parentPath: verifiedPath,
      principalPolicyCache: input.principalPolicyCache,
      resolveUserKey: input.resolveUserKey,
      requireAuthorizationEvidence: input.requireAuthorizationEvidence,
      verifiedByHash: input.verifiedByHash,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    // Access along a path is the union of its elements' grants, so a served
    // path must be a genuine root-to-leaf ancestor chain: each element is the
    // parent of the next, and the first is a root.
    const expectedParentId = verifiedPath.at(-1)?.state.containerId ?? null;
    if (verified.state.parentContainerId !== expectedParentId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${label} parent container does not precede it in the path`,
      );
    }
    if (holdToServedAncestors) {
      const servedAncestors = [...verifiedPath];
      await assertNewHeadCitesServedAncestors({
        authorizeAtServedPath: servedPathAuthorization(
          input,
          verified,
          label,
          servedAncestors,
        ),
        execSql: input.checkpointContext.execSql,
        head: verified,
        label,
        localCheckpoints: input.checkpointContext.localCheckpoints,
        servedAncestors,
        verifiedByHash: input.verifiedByHash,
      });
    }
    verifiedPath.push(verified);
  }

  return verifiedPath;
}
