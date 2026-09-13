export interface VerifiedContainerInterest {
  readonly containerId: string;
  readonly pathContainerIds: readonly string[];
}

export type AuthorizeContainerAccess = (
  userId: string,
  containerIds: string[],
) => Promise<VerifiedContainerInterest[]>;
