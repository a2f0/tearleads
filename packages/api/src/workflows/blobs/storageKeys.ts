/** Stage keys remain unchanged when promoted and when queued for deletion. */
export function storageKeyForBlobStage(
  organizationId: string,
  stageId: string,
): string {
  return `organizations/${encodeURIComponent(organizationId)}/blob-stages/${encodeURIComponent(stageId)}`;
}

export function assertBlobStorageKeyOrganization(
  storageKey: string,
  organizationId: string,
): void {
  const prefix = `organizations/${encodeURIComponent(organizationId)}/blob-stages/`;
  const stageId = storageKey.slice(prefix.length);
  if (!storageKey.startsWith(prefix) || !stageId || stageId.includes("/")) {
    throw new Error("Blob storage key does not match its organization");
  }
}
