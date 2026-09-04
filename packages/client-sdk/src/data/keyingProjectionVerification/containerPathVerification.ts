import {
  type AccessManifestCheckpoint,
  type AnyVerifiedPrincipalPolicy,
  type ContainerAccessLevel,
  KeyingVerificationError,
  requireContainerPathUserAccess,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { assertNewHeadCitesServedAncestors } from "./containerAncestorCurrency";
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
 * What a container event's signer needs at the served current path, as the
 * manifest verifier requires it at the cited path: write on the parent path
 * for a create and on the destination path for a move (a move's source
 * admin authority is held to this device's checkpoints instead), and admin
 * or write on the container's own state beneath its ancestors for a grant,
 * revoke, or rekey.
 */
function containerEventServedPathAccess(
  head: VerifiedContainerAccessManifest,
  label: string,
): {
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly ownState: boolean;
} {
  const eventType = head.event.event.eventType;
  switch (eventType) {
    case "container.create":
    case "container.move":
      return { minimumAccessLevel: "write", ownState: false };
    case "container.grant":
    case "container.revoke":
      return { minimumAccessLevel: "admin", ownState: true };
    case "container.rekey":
      return { minimumAccessLevel: "write", ownState: true };
    default:
      throw new KeyingVerificationError(
        "invalid_shape",
        `${label} has an unknown container event type ${String(eventType)}`,
      );
  }
}

/**
 * The access a container event needs, checked at the served current path
 * instead of the ancestors the event cites. The container's own grants are
 * read from its state as this device last accepted it, the manifest at the
 * local checkpoint, never from the head's unheld predecessors: those a
 * member revoked at an ancestor could have written themselves, citing the
 * head that still granted them, to lend the re-check an authority no
 * current admin gave.
 */
function servedPathAuthorization(
  input: ContainerManifestPathInput,
  head: VerifiedContainerAccessManifest,
  label: string,
  servedAncestors: readonly VerifiedContainerAccessManifest[],
): (localCheckpoint: AccessManifestCheckpoint) => Promise<void> {
  return async (localCheckpoint) => {
    const access = containerEventServedPathAccess(head, label);
    const checkpointed = input.verifiedByHash.get(localCheckpoint.manifestHash);
    if (
      access.ownState &&
      checkpointed?.state.containerId !== head.state.containerId
    ) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${label} manifest at this device's checkpoint is not served`,
      );
    }
    const path =
      access.ownState && checkpointed
        ? [...servedAncestors, checkpointed]
        : [...servedAncestors];
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
      // Only a path verified at current membership is held to this.
      membershipAt: "current",
      minimumAccessLevel: access.minimumAccessLevel,
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
