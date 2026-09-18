/**
 * The containers a move unlinks after its link landed. The candidates are
 * read off the VERIFIED document manifest's link set (`linkedContainerIds`),
 * never off a server-asserted hint: a source drops out only when the manifest
 * itself no longer lists it. A source the manifest still lists is always
 * attempted — if the server then refuses that unlink, the move stays partial
 * rather than completing with a live link nobody revoked.
 */
export function resolveContainerDocumentMoveUnlinkIds(input: {
  linkOnly?: boolean | undefined;
  additionalLinkContainerIds?: readonly string[] | undefined;
  removedLinkContainerIds?: readonly string[] | undefined;
  currentContainerId: string;
  linkedContainerIds: readonly string[];
  replaceLinkedContainers?: boolean | undefined;
  targetContainerId: string;
}): string[] {
  let unlinkContainerIds: readonly string[] = [];
  if (!input.linkOnly) {
    unlinkContainerIds = input.replaceLinkedContainers
      ? input.linkedContainerIds.filter(
          (containerId) => containerId !== input.targetContainerId,
        )
      : [input.currentContainerId];
  }

  return Array.from(
    new Set([...unlinkContainerIds, ...(input.removedLinkContainerIds ?? [])]),
  ).filter(
    (containerId) =>
      (containerId !== input.targetContainerId ||
        input.removedLinkContainerIds?.includes(containerId)) &&
      !input.additionalLinkContainerIds?.includes(containerId) &&
      input.linkedContainerIds.includes(containerId),
  );
}
