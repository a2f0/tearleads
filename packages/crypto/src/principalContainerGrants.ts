import { toFingerprint } from "./fingerprint";
import type { PrincipalContainerGrant } from "./principalStateTypes";

const TEXT_ENCODER = new TextEncoder();

function comparePrincipalContainerGrants(
  left: PrincipalContainerGrant,
  right: PrincipalContainerGrant,
): number {
  const containerComparison = left.containerId.localeCompare(right.containerId);
  return containerComparison !== 0
    ? containerComparison
    : left.accessLevel.localeCompare(right.accessLevel);
}

export function normalizePrincipalContainerGrants(
  grants: ReadonlyArray<PrincipalContainerGrant>,
): PrincipalContainerGrant[] {
  const normalized = grants
    .map((grant) => {
      if (
        typeof grant.containerId !== "string" ||
        grant.containerId.length === 0 ||
        (grant.accessLevel !== "admin" &&
          grant.accessLevel !== "read" &&
          grant.accessLevel !== "write")
      ) {
        throw new Error("Principal container grant is invalid");
      }
      return {
        accessLevel: grant.accessLevel,
        containerId: grant.containerId,
      };
    })
    .sort(comparePrincipalContainerGrants);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.containerId === normalized[index]?.containerId) {
      throw new Error("Principal cannot contain duplicate container grants");
    }
  }
  return normalized;
}

export async function computePrincipalContainerGrantRoot(
  grants: ReadonlyArray<PrincipalContainerGrant>,
): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      JSON.stringify(
        normalizePrincipalContainerGrants(grants).map((grant) => ({
          accessLevel: grant.accessLevel,
          containerId: grant.containerId,
        })),
      ),
    ),
  );
}
