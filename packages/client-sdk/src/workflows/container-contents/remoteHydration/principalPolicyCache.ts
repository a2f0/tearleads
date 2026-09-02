import type { ReferencedPrincipalPolicyWarmer } from "../../../data/keyingProjectionVerification";
import { referencedPrincipalPolicyKey } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import type { RemoteContainer } from "./types";

type RemoteContainerPrincipalReferences = Pick<
  RemoteContainer,
  "metadataReferencedPrincipals" | "organizationId"
>;
type PrincipalReference =
  RemoteContainer["metadataReferencedPrincipals"][number];

export async function cacheRemoteContainerPrincipalPolicies(input: {
  readonly cacheReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
  readonly remoteContainers: readonly RemoteContainerPrincipalReferences[];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const cacheReferencedPrincipalPolicies =
    input.cacheReferencedPrincipalPolicies;
  if (!cacheReferencedPrincipalPolicies) {
    return;
  }

  const referencesByOrganizationId = new Map<
    string,
    Map<string, PrincipalReference>
  >();

  for (const remoteContainer of input.remoteContainers) {
    const references = remoteContainer.metadataReferencedPrincipals;
    const { organizationId } = remoteContainer;
    if (references.length === 0 || !organizationId) {
      continue;
    }

    const organizationReferences =
      referencesByOrganizationId.get(organizationId) ?? new Map();
    for (const reference of references) {
      organizationReferences.set(
        referencedPrincipalPolicyKey(reference),
        reference,
      );
    }
    referencesByOrganizationId.set(organizationId, organizationReferences);
  }

  await Promise.all(
    [...referencesByOrganizationId].map(([organizationId, referencesByKey]) =>
      cacheReferencedPrincipalPolicies({
        organizationId,
        references: [...referencesByKey.values()],
        stillCurrent: input.stillCurrent,
      }),
    ),
  );
}
