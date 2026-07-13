import type { ReferencedPrincipalPolicyWarmer } from "../../../data/keyingProjectionVerification";
import type { RemoteContainer } from "./types";

type RemoteContainerPrincipalReferences = Pick<
  RemoteContainer,
  "metadataReferencedPrincipals" | "organizationId"
>;

export async function cacheRemoteContainerPrincipalPolicies(input: {
  readonly cacheReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
  readonly remoteContainers: readonly RemoteContainerPrincipalReferences[];
}): Promise<void> {
  const cacheReferencedPrincipalPolicies =
    input.cacheReferencedPrincipalPolicies;
  if (!cacheReferencedPrincipalPolicies) {
    return;
  }

  const referencesByOrganizationId = new Map<
    string,
    NonNullable<RemoteContainer["metadataReferencedPrincipals"]>[number][]
  >();

  for (const remoteContainer of input.remoteContainers) {
    const references = remoteContainer.metadataReferencedPrincipals ?? [];
    if (references.length === 0) {
      continue;
    }

    const organizationReferences =
      referencesByOrganizationId.get(remoteContainer.organizationId) ?? [];
    organizationReferences.push(...references);
    referencesByOrganizationId.set(
      remoteContainer.organizationId,
      organizationReferences,
    );
  }

  await Promise.all(
    [...referencesByOrganizationId].map(([organizationId, references]) =>
      cacheReferencedPrincipalPolicies({ organizationId, references }),
    ),
  );
}
