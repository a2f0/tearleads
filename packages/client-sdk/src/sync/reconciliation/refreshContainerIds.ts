interface RefreshContainerHost {
  readonly canDiscoverContainerDocuments: (containerId: string) => boolean;
  readonly listKnownContainerIds: () => ReadonlyArray<string>;
}

export function listFullRefreshContainerIds(
  host: RefreshContainerHost,
  activeContainerId: string | null,
): ReadonlyArray<string> {
  const knownIds = host.listKnownContainerIds();
  if (
    !activeContainerId ||
    knownIds.includes(activeContainerId) ||
    !host.canDiscoverContainerDocuments(activeContainerId)
  ) {
    return knownIds;
  }

  // The generic set excludes write-only foreign system containers. Refresh
  // still retries an explicitly opened one while sweeps remain filtered.
  return [...knownIds, activeContainerId];
}
