import type { VfsBlobDownloadOperation } from '@tearleads/api-client/clientEntry';
import type { VfsCrdtSyncItem } from '@tearleads/shared';

export function extractBlobRefsFromSyncItems(
  items: VfsCrdtSyncItem[]
): Array<{ blobId: string; itemId: string; sizeBytes: number }> {
  const seen = new Set<string>();
  const refs: Array<{ blobId: string; itemId: string; sizeBytes: number }> = [];

  for (const item of items) {
    if (item.blobId && !seen.has(item.blobId)) {
      seen.add(item.blobId);
      refs.push({
        blobId: item.blobId,
        itemId: item.itemId,
        sizeBytes: item.blobSizeBytes ?? 0
      });
    }
  }

  return refs;
}

export async function discoverPendingBlobDownloads(
  blobRefs: Array<{ blobId: string; itemId: string; sizeBytes: number }>,
  existsLocal: (blobId: string) => Promise<boolean>
): Promise<VfsBlobDownloadOperation[]> {
  const pending: VfsBlobDownloadOperation[] = [];

  for (const ref of blobRefs) {
    const exists = await existsLocal(ref.blobId);
    if (!exists) {
      pending.push({
        operationId: `dl-${ref.blobId}-${Date.now()}`,
        blobId: ref.blobId,
        itemId: ref.itemId,
        sizeBytes: ref.sizeBytes
      });
    }
  }

  return pending;
}
