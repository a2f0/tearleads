export interface VerifiedContainerInterest {
  readonly containerId: string;
  readonly pathContainerIds: readonly string[];
  readonly principalKeys: readonly string[];
}

export type AuthorizeContainerAccess = (
  userId: string,
  containerIds: string[],
) => Promise<VerifiedContainerInterest[]>;

export function principalInterestKey(principal: {
  principalType: string;
  principalId: string;
}): string {
  return `principal:${principal.principalType}:${principal.principalId}`;
}
