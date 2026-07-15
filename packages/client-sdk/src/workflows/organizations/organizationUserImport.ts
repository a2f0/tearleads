import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";

export interface ImportedOrganizationUser {
  readonly userId: string;
}

export async function importOrganizationUser(input: {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly userId: string;
}): Promise<ImportedOrganizationUser | null> {
  const userId = input.userId.trim();
  if (userId.length === 0) {
    return null;
  }

  const identity = await requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  )(userId);
  return identity ? { userId: identity.userId } : null;
}
