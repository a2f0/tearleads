export interface VfsBlobObjectStore {
  hasBlob(blobId: string): boolean;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

class AlwaysAvailableVfsBlobObjectStore implements VfsBlobObjectStore {
  hasBlob(_blobId: string): boolean {
    return true;
  }
}

export const alwaysAvailableVfsBlobObjectStore: VfsBlobObjectStore =
  new AlwaysAvailableVfsBlobObjectStore();

/**
 * Test/store harness for object-store behavior. This is the boundary that an
 * S3-compatible backend can implement later without changing blob commit rules.
 */
export class InMemoryVfsBlobObjectStore implements VfsBlobObjectStore {
  private readonly availableBlobIds = new Set<string>();

  registerBlob(blobId: string): boolean {
    const normalizedBlobId = normalizeNonEmptyString(blobId);
    if (!normalizedBlobId) {
      return false;
    }

    const existed = this.availableBlobIds.has(normalizedBlobId);
    this.availableBlobIds.add(normalizedBlobId);
    return !existed;
  }

  removeBlob(blobId: string): boolean {
    const normalizedBlobId = normalizeNonEmptyString(blobId);
    if (!normalizedBlobId) {
      return false;
    }

    return this.availableBlobIds.delete(normalizedBlobId);
  }

  hasBlob(blobId: string): boolean {
    const normalizedBlobId = normalizeNonEmptyString(blobId);
    if (!normalizedBlobId) {
      return false;
    }

    return this.availableBlobIds.has(normalizedBlobId);
  }

  snapshot(): string[] {
    return Array.from(this.availableBlobIds).sort((left, right) =>
      left.localeCompare(right)
    );
  }
}
