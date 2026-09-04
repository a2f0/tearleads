import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { assertServedAncestorsDescendFromCitations } from "./containerAncestorCitations";
import { verifyContainerManifestBundle } from "./containerManifestVerification";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

export async function verifyContainerManifestPath(input: {
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
}): Promise<VerifiedContainerAccessManifest[]> {
  // A checkpoint-enforced path verified at current membership is the current
  // one, so the heads it serves above an element must be or descend from the
  // heads that element's signed event cites. A signed snapshot such as a
  // purge's authorizing path is verified at referenced membership and is the
  // path its event cited.
  const servedAsCurrent =
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
    if (servedAsCurrent) {
      assertServedAncestorsDescendFromCitations({
        head: verified,
        label,
        servedAncestors: verifiedPath,
        verifiedByHash: input.verifiedByHash,
      });
    }
    verifiedPath.push(verified);
  }

  return verifiedPath;
}
