import type { ReferencedPrincipalPolicyWarmer } from "../../../data/keyingProjectionVerification";
import { referencedPrincipalPolicyKey } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { isKeyingVerificationError } from "../../../data/shared/securityIncidents";
import type { RemoteContainer } from "./types";

type RemoteContainerPrincipalReferences = Pick<
  RemoteContainer,
  "metadataReferencedPrincipals" | "organizationId"
>;
type PrincipalReference =
  RemoteContainer["metadataReferencedPrincipals"][number];

async function warmUnlessRefused(warm: () => Promise<void>): Promise<boolean> {
  try {
    await warm();
    return true;
  } catch (error) {
    if (isKeyingVerificationError(error)) return false;
    throw error;
  }
}

export async function cacheRemoteContainerPrincipalPolicies(input: {
  readonly cacheReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
  readonly onRefused?: (
    organizationId: string,
    reference: PrincipalReference,
  ) => void;
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
    [...referencesByOrganizationId].map(
      async ([organizationId, referencesByKey]) => {
        const references = [...referencesByKey.values()];
        const warm = (group: readonly PrincipalReference[]) =>
          cacheReferencedPrincipalPolicies({
            organizationId,
            references: group,
            stillCurrent: input.stillCurrent,
          });
        if (!input.onRefused) return warm(references);
        if (await warmUnlessRefused(() => warm(references))) return;
        // A failed batch identifies no individual reference. Isolate it
        // without excluding independent containers in the same organization.
        for (const reference of references) {
          if (input.stillCurrent?.() === false) return;
          if (
            references.length === 1 ||
            !(await warmUnlessRefused(() => warm([reference])))
          )
            input.onRefused(organizationId, reference);
        }
      },
    ),
  );
}

export async function warmListedContainerPolicies<
  T extends RemoteContainerPrincipalReferences,
>(
  items: readonly T[],
  warmer: ReferencedPrincipalPolicyWarmer,
  isolateRefusals: boolean,
  stillCurrent?: () => boolean,
): Promise<{ items: readonly T[]; outcome: "complete" | "refused" }> {
  const refused = new Set<string>();
  const key = (organizationId: string, reference: PrincipalReference) =>
    JSON.stringify([organizationId, referencedPrincipalPolicyKey(reference)]);
  await cacheRemoteContainerPrincipalPolicies({
    cacheReferencedPrincipalPolicies: warmer,
    remoteContainers: items,
    stillCurrent,
    ...(isolateRefusals && {
      onRefused: (org: string, ref: PrincipalReference) => {
        refused.add(key(org, ref));
      },
    }),
  });
  if (!refused.size) return { items, outcome: "complete" };
  return {
    outcome: "refused",
    items: items.filter(
      (item) =>
        !item.metadataReferencedPrincipals.some((ref) =>
          refused.has(key(item.organizationId, ref)),
        ),
    ),
  };
}
