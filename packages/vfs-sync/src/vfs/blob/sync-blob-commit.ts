import {
  alwaysAvailableVfsBlobObjectStore,
  type VfsBlobObjectStore
} from './sync-blob-object-store.js';

export type VfsBlobStageStatus = 'staged' | 'attached' | 'abandoned';

export interface VfsBlobStageRecord {
  stagingId: string;
  blobId: string;
  stagedBy: string;
  status: VfsBlobStageStatus;
  stagedAt: string;
  expiresAt: string;
  attachedAt: string | null;
  attachedItemId: string | null;
}

export interface StageVfsBlobInput {
  stagingId: string;
  blobId: string;
  stagedBy: string;
  stagedAt: string;
  expiresAt: string;
}

export interface AttachVfsBlobInput {
  stagingId: string;
  attachedBy: string;
  itemId: string;
  attachedAt: string;
}

export interface AbandonVfsBlobInput {
  stagingId: string;
  abandonedBy: string;
  abandonedAt: string;
}

export type VfsBlobCommitStatus =
  | 'applied'
  | 'notFound'
  | 'invalid'
  | 'conflict'
  | 'forbidden'
  | 'unavailable'
  | 'expired';

export interface VfsBlobCommitResult {
  stagingId: string;
  status: VfsBlobCommitStatus;
  record: VfsBlobStageRecord | null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(
  value: unknown
): { iso: string; ms: number } | null {
  const rawValue = normalizeNonEmptyString(value);
  if (!rawValue) {
    return null;
  }

  const ms = Date.parse(rawValue);
  if (!Number.isFinite(ms)) {
    return null;
  }

  return {
    iso: new Date(ms).toISOString(),
    ms
  };
}

function cloneRecord(record: VfsBlobStageRecord): VfsBlobStageRecord {
  return {
    stagingId: record.stagingId,
    blobId: record.blobId,
    stagedBy: record.stagedBy,
    status: record.status,
    stagedAt: record.stagedAt,
    expiresAt: record.expiresAt,
    attachedAt: record.attachedAt,
    attachedItemId: record.attachedItemId
  };
}

export class InMemoryVfsBlobCommitStore {
  private readonly records: Map<string, VfsBlobStageRecord> = new Map();
  private readonly objectStore: VfsBlobObjectStore;

  constructor(
    objectStore: VfsBlobObjectStore = alwaysAvailableVfsBlobObjectStore
  ) {
    this.objectStore = objectStore;
  }

  stage(input: StageVfsBlobInput): VfsBlobCommitResult {
    const stagingId = normalizeNonEmptyString(input.stagingId);
    const blobId = normalizeNonEmptyString(input.blobId);
    const stagedBy = normalizeNonEmptyString(input.stagedBy);
    const stagedAt = normalizeTimestamp(input.stagedAt);
    const expiresAt = normalizeTimestamp(input.expiresAt);

    if (!stagingId || !blobId || !stagedBy || !stagedAt || !expiresAt) {
      return {
        stagingId: stagingId ?? 'invalid-stage',
        status: 'invalid',
        record: null
      };
    }

    if (stagedAt.ms >= expiresAt.ms) {
      return {
        stagingId,
        status: 'invalid',
        record: null
      };
    }

    const existingRecord = this.records.get(stagingId);
    if (existingRecord) {
      return {
        stagingId,
        status: 'conflict',
        record: cloneRecord(existingRecord)
      };
    }

    const record: VfsBlobStageRecord = {
      stagingId,
      blobId,
      stagedBy,
      status: 'staged',
      stagedAt: stagedAt.iso,
      expiresAt: expiresAt.iso,
      attachedAt: null,
      attachedItemId: null
    };

    this.records.set(stagingId, record);

    return {
      stagingId,
      status: 'applied',
      record: cloneRecord(record)
    };
  }

  attach(input: AttachVfsBlobInput): VfsBlobCommitResult {
    const stagingId = normalizeNonEmptyString(input.stagingId);
    const attachedBy = normalizeNonEmptyString(input.attachedBy);
    const itemId = normalizeNonEmptyString(input.itemId);
    const attachedAt = normalizeTimestamp(input.attachedAt);

    if (!stagingId || !attachedBy || !itemId || !attachedAt) {
      return {
        stagingId: stagingId ?? 'invalid-attach',
        status: 'invalid',
        record: null
      };
    }

    const existingRecord = this.records.get(stagingId);
    if (!existingRecord) {
      return {
        stagingId,
        status: 'notFound',
        record: null
      };
    }

    if (existingRecord.stagedBy !== attachedBy) {
      return {
        stagingId,
        status: 'forbidden',
        record: cloneRecord(existingRecord)
      };
    }

    if (existingRecord.status !== 'staged') {
      return {
        stagingId,
        status: 'conflict',
        record: cloneRecord(existingRecord)
      };
    }

    /**
     * Guardrail: attachment commits must fail closed when blob content is not
     * visible in the backing object store. This boundary enables S3-compatible
     * backends without weakening commit isolation semantics.
     */
    let hasBlob = false;
    try {
      hasBlob = this.objectStore.hasBlob(existingRecord.blobId);
    } catch {
      return {
        stagingId,
        status: 'unavailable',
        record: cloneRecord(existingRecord)
      };
    }

    if (!hasBlob) {
      return {
        stagingId,
        status: 'notFound',
        record: cloneRecord(existingRecord)
      };
    }

    const expiresAtMs = Date.parse(existingRecord.expiresAt);
    const stagedAtMs = Date.parse(existingRecord.stagedAt);
    if (attachedAt.ms < stagedAtMs) {
      return {
        stagingId,
        status: 'invalid',
        record: cloneRecord(existingRecord)
      };
    }

    if (attachedAt.ms >= expiresAtMs) {
      return {
        stagingId,
        status: 'expired',
        record: cloneRecord(existingRecord)
      };
    }

    existingRecord.status = 'attached';
    existingRecord.attachedAt = attachedAt.iso;
    existingRecord.attachedItemId = itemId;

    return {
      stagingId,
      status: 'applied',
      record: cloneRecord(existingRecord)
    };
  }

  abandon(input: AbandonVfsBlobInput): VfsBlobCommitResult {
    const stagingId = normalizeNonEmptyString(input.stagingId);
    const abandonedBy = normalizeNonEmptyString(input.abandonedBy);
    const abandonedAt = normalizeTimestamp(input.abandonedAt);

    if (!stagingId || !abandonedBy || !abandonedAt) {
      return {
        stagingId: stagingId ?? 'invalid-abandon',
        status: 'invalid',
        record: null
      };
    }

    const existingRecord = this.records.get(stagingId);
    if (!existingRecord) {
      return {
        stagingId,
        status: 'notFound',
        record: null
      };
    }

    if (existingRecord.stagedBy !== abandonedBy) {
      return {
        stagingId,
        status: 'forbidden',
        record: cloneRecord(existingRecord)
      };
    }

    if (existingRecord.status !== 'staged') {
      return {
        stagingId,
        status: 'conflict',
        record: cloneRecord(existingRecord)
      };
    }

    if (abandonedAt.ms < Date.parse(existingRecord.stagedAt)) {
      return {
        stagingId,
        status: 'invalid',
        record: cloneRecord(existingRecord)
      };
    }

    existingRecord.status = 'abandoned';

    return {
      stagingId,
      status: 'applied',
      record: cloneRecord(existingRecord)
    };
  }

  sweepExpired(nowIso: string): VfsBlobStageRecord[] {
    const now = normalizeTimestamp(nowIso);
    if (!now) {
      return [];
    }

    const abandoned: VfsBlobStageRecord[] = [];
    for (const record of this.records.values()) {
      if (record.status !== 'staged') {
        continue;
      }

      if (Date.parse(record.expiresAt) <= now.ms) {
        record.status = 'abandoned';
        abandoned.push(cloneRecord(record));
      }
    }

    abandoned.sort((left, right) =>
      left.stagingId.localeCompare(right.stagingId)
    );
    return abandoned;
  }

  get(stagingId: string): VfsBlobStageRecord | null {
    const normalizedStagingId = normalizeNonEmptyString(stagingId);
    if (!normalizedStagingId) {
      return null;
    }

    const record = this.records.get(normalizedStagingId);
    if (!record) {
      return null;
    }

    return cloneRecord(record);
  }

  snapshot(): VfsBlobStageRecord[] {
    const values = Array.from(this.records.values()).map((record) =>
      cloneRecord(record)
    );

    values.sort((left, right) => left.stagingId.localeCompare(right.stagingId));
    return values;
  }
}
