import {
  type AnyVerifiedPrincipalPolicy,
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
