import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  principalPolicyMatchesReference,
  type VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

export type UsedDocumentContainerManifests = Map<
  string,
  VerifiedContainerAccessManifest
>;

export async function collectDocumentManifestPrincipalPolicies(input: {
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly paths: readonly (
    | readonly VerifiedContainerAccessManifest[]
    | undefined
  )[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly requireAuthorizationEvidence?: boolean | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<AnyVerifiedPrincipalPolicy[]> {
  const authorizationEvidence = input.authorizationEvidence ?? [];
  const references = input.paths
    .flatMap((path) =>
      (path ?? []).flatMap(
        (manifest) => manifest.state.referencedPrincipalHeads,
      ),
    )
    .filter(
      (reference) =>
        !authorizationEvidence.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        ),
    );
  if (input.requireAuthorizationEvidence && references.length > 0) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Projection omits required principal policy evidence",
    );
  }
  if (input.requireAuthorizationEvidence) return [...authorizationEvidence];
  return [
    ...authorizationEvidence,
    ...(await collectReferencedPrincipalPolicies({
      checkpointContext: input.checkpointContext,
      organizationId: input.organizationId,
      principalPolicyCache: input.principalPolicyCache,
      references,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    })),
  ];
}

export function recordUsedDocumentContainerManifests(input: {
  readonly paths: readonly (
    | readonly VerifiedContainerAccessManifest[]
    | undefined
  )[];
  readonly used?: UsedDocumentContainerManifests | undefined;
}): void {
  for (const path of input.paths) {
    for (const manifest of path ?? []) {
      input.used?.set(manifest.manifestHash, manifest);
    }
  }
}
