import { describe, expect, it } from 'vitest';
import {
  type AttachVfsBlobInput,
  InMemoryVfsBlobCommitStore,
  type VfsBlobCommitResult
} from './sync-blob-commit.js';
import {
  InMemoryVfsBlobObjectStore,
  type VfsBlobObjectStore
} from './sync-blob-object-store.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class BlobCommitRaceHarness {
  constructor(private readonly store: InMemoryVfsBlobCommitStore) {}

  raceAttach(inputs: Array<{ input: AttachVfsBlobInput; delayMs: number }>) {
    return Promise.all(
      inputs.map(async ({ input, delayMs }) => {
        await wait(delayMs);
        return this.store.attach(input);
      })
    );
  }
}

describe('InMemoryVfsBlobCommitStore', () => {
  it('stages then attaches a blob before expiry', () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-1');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    const staged = store.stage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T10:00:00.000Z',
      expiresAt: '2026-02-14T10:30:00.000Z'
    });

    const attached = store.attach({
      stagingId: 'stage-1',
      attachedBy: 'user-1',
      itemId: 'item-1',
      attachedAt: '2026-02-14T10:10:00.000Z'
    });

    expect(staged.status).toBe('applied');
    expect(attached).toEqual({
      stagingId: 'stage-1',
      status: 'applied',
      record: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        stagedBy: 'user-1',
        status: 'attached',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T10:30:00.000Z',
        attachedAt: '2026-02-14T10:10:00.000Z',
        attachedItemId: 'item-1'
      }
    });
  });

  it('serializes concurrent attach attempts so only one succeeds', async () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-2');
    const store = new InMemoryVfsBlobCommitStore(objectStore);
    const harness = new BlobCommitRaceHarness(store);

    store.stage({
      stagingId: 'stage-2',
      blobId: 'blob-2',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T10:00:00.000Z',
      expiresAt: '2026-02-14T10:30:00.000Z'
    });

    const results = await harness.raceAttach([
      {
        delayMs: 15,
        input: {
          stagingId: 'stage-2',
          attachedBy: 'user-1',
          itemId: 'item-a',
          attachedAt: '2026-02-14T10:11:00.000Z'
        }
      },
      {
        delayMs: 5,
        input: {
          stagingId: 'stage-2',
          attachedBy: 'user-1',
          itemId: 'item-b',
          attachedAt: '2026-02-14T10:10:00.000Z'
        }
      }
    ]);

    const successCount = results.filter(
      (result) => result.status === 'applied'
    ).length;
    const conflictCount = results.filter(
      (result) => result.status === 'conflict'
    ).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(1);

    expect(store.get('stage-2')).toEqual({
      stagingId: 'stage-2',
      blobId: 'blob-2',
      stagedBy: 'user-1',
      status: 'attached',
      stagedAt: '2026-02-14T10:00:00.000Z',
      expiresAt: '2026-02-14T10:30:00.000Z',
      attachedAt: '2026-02-14T10:10:00.000Z',
      attachedItemId: 'item-b'
    });
  });

  it('resolves attach/abandon races through status checks', async () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-3');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    store.stage({
      stagingId: 'stage-3',
      blobId: 'blob-3',
      stagedBy: 'user-9',
      stagedAt: '2026-02-14T11:00:00.000Z',
      expiresAt: '2026-02-14T11:30:00.000Z'
    });

    const [abandoned, attached]: VfsBlobCommitResult[] = await Promise.all([
      (async () => {
        await wait(5);
        return store.abandon({
          stagingId: 'stage-3',
          abandonedBy: 'user-9',
          abandonedAt: '2026-02-14T11:05:00.000Z'
        });
      })(),
      (async () => {
        await wait(10);
        return store.attach({
          stagingId: 'stage-3',
          attachedBy: 'user-9',
          itemId: 'item-race',
          attachedAt: '2026-02-14T11:04:00.000Z'
        });
      })()
    ]);

    expect(abandoned.status).toBe('applied');
    expect(attached.status).toBe('conflict');
    expect(store.get('stage-3')?.status).toBe('abandoned');
  });

  it('blocks attaching after expiry and sweeps expired staged blobs', () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-4');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    store.stage({
      stagingId: 'stage-4',
      blobId: 'blob-4',
      stagedBy: 'user-4',
      stagedAt: '2026-02-14T12:00:00.000Z',
      expiresAt: '2026-02-14T12:10:00.000Z'
    });

    const expiredAttach = store.attach({
      stagingId: 'stage-4',
      attachedBy: 'user-4',
      itemId: 'item-4',
      attachedAt: '2026-02-14T12:11:00.000Z'
    });

    expect(expiredAttach.status).toBe('expired');
    expect(store.get('stage-4')?.status).toBe('staged');

    const swept = store.sweepExpired('2026-02-14T12:11:00.000Z');
    expect(swept).toEqual([
      {
        stagingId: 'stage-4',
        blobId: 'blob-4',
        stagedBy: 'user-4',
        status: 'abandoned',
        stagedAt: '2026-02-14T12:00:00.000Z',
        expiresAt: '2026-02-14T12:10:00.000Z',
        attachedAt: null,
        attachedItemId: null
      }
    ]);

    expect(store.get('stage-4')?.status).toBe('abandoned');
  });

  it('rejects invalid and unauthorized transitions', () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-6');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    const invalidStage = store.stage({
      stagingId: 'stage-5',
      blobId: 'blob-5',
      stagedBy: 'user-5',
      stagedAt: 'bad-date',
      expiresAt: '2026-02-14T12:10:00.000Z'
    });

    store.stage({
      stagingId: 'stage-6',
      blobId: 'blob-6',
      stagedBy: 'user-6',
      stagedAt: '2026-02-14T12:00:00.000Z',
      expiresAt: '2026-02-14T12:10:00.000Z'
    });

    const forbiddenAttach = store.attach({
      stagingId: 'stage-6',
      attachedBy: 'user-7',
      itemId: 'item-x',
      attachedAt: '2026-02-14T12:01:00.000Z'
    });

    expect(invalidStage.status).toBe('invalid');
    expect(forbiddenAttach.status).toBe('forbidden');
  });

  it('keeps first successful attach durable across retries for email-linked items', () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-7');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    store.stage({
      stagingId: 'stage-7',
      blobId: 'blob-7',
      stagedBy: 'user-7',
      stagedAt: '2026-02-14T13:00:00.000Z',
      expiresAt: '2026-02-14T13:30:00.000Z'
    });

    const firstAttach = store.attach({
      stagingId: 'stage-7',
      attachedBy: 'user-7',
      itemId: 'email-7',
      attachedAt: '2026-02-14T13:05:00.000Z'
    });
    const retrySamePayload = store.attach({
      stagingId: 'stage-7',
      attachedBy: 'user-7',
      itemId: 'email-7',
      attachedAt: '2026-02-14T13:05:00.000Z'
    });
    const retryDifferentTarget = store.attach({
      stagingId: 'stage-7',
      attachedBy: 'user-7',
      itemId: 'email-7-retry',
      attachedAt: '2026-02-14T13:05:01.000Z'
    });

    expect(firstAttach.status).toBe('applied');
    expect(retrySamePayload.status).toBe('conflict');
    expect(retryDifferentTarget.status).toBe('conflict');
    expect(store.get('stage-7')).toEqual({
      stagingId: 'stage-7',
      blobId: 'blob-7',
      stagedBy: 'user-7',
      status: 'attached',
      stagedAt: '2026-02-14T13:00:00.000Z',
      expiresAt: '2026-02-14T13:30:00.000Z',
      attachedAt: '2026-02-14T13:05:00.000Z',
      attachedItemId: 'email-7'
    });
  });

  it('preserves terminal state under interrupted attach/abandon races with retries', async () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    objectStore.registerBlob('blob-8');
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    store.stage({
      stagingId: 'stage-8',
      blobId: 'blob-8',
      stagedBy: 'user-8',
      stagedAt: '2026-02-14T14:00:00.000Z',
      expiresAt: '2026-02-14T14:30:00.000Z'
    });

    const [attached, abandoned]: VfsBlobCommitResult[] = await Promise.all([
      (async () => {
        await wait(5);
        return store.attach({
          stagingId: 'stage-8',
          attachedBy: 'user-8',
          itemId: 'email-8',
          attachedAt: '2026-02-14T14:05:00.000Z'
        });
      })(),
      (async () => {
        await wait(10);
        return store.abandon({
          stagingId: 'stage-8',
          abandonedBy: 'user-8',
          abandonedAt: '2026-02-14T14:05:01.000Z'
        });
      })()
    ]);

    const abandonRetry = store.abandon({
      stagingId: 'stage-8',
      abandonedBy: 'user-8',
      abandonedAt: '2026-02-14T14:05:02.000Z'
    });
    const attachRetry = store.attach({
      stagingId: 'stage-8',
      attachedBy: 'user-8',
      itemId: 'email-8-retry',
      attachedAt: '2026-02-14T14:05:03.000Z'
    });

    expect(attached.status).toBe('applied');
    expect(abandoned.status).toBe('conflict');
    expect(abandonRetry.status).toBe('conflict');
    expect(attachRetry.status).toBe('conflict');
    expect(store.get('stage-8')).toEqual({
      stagingId: 'stage-8',
      blobId: 'blob-8',
      stagedBy: 'user-8',
      status: 'attached',
      stagedAt: '2026-02-14T14:00:00.000Z',
      expiresAt: '2026-02-14T14:30:00.000Z',
      attachedAt: '2026-02-14T14:05:00.000Z',
      attachedItemId: 'email-8'
    });
  });

  it('fails closed when blob payload is missing from object store', () => {
    const objectStore = new InMemoryVfsBlobObjectStore();
    const store = new InMemoryVfsBlobCommitStore(objectStore);

    store.stage({
      stagingId: 'stage-9',
      blobId: 'blob-9',
      stagedBy: 'user-9',
      stagedAt: '2026-02-14T15:00:00.000Z',
      expiresAt: '2026-02-14T15:30:00.000Z'
    });

    const missingBlobAttach = store.attach({
      stagingId: 'stage-9',
      attachedBy: 'user-9',
      itemId: 'email-9',
      attachedAt: '2026-02-14T15:05:00.000Z'
    });
    expect(missingBlobAttach.status).toBe('notFound');
    expect(store.get('stage-9')?.status).toBe('staged');

    objectStore.registerBlob('blob-9');

    const attached = store.attach({
      stagingId: 'stage-9',
      attachedBy: 'user-9',
      itemId: 'email-9',
      attachedAt: '2026-02-14T15:05:01.000Z'
    });
    expect(attached.status).toBe('applied');
    expect(store.get('stage-9')?.attachedItemId).toBe('email-9');
  });

  it('fails closed when object-store availability checks are transiently unavailable', () => {
    let availabilityChecks = 0;
    const transientObjectStore: VfsBlobObjectStore = {
      hasBlob: () => {
        availabilityChecks += 1;
        if (availabilityChecks === 1) {
          throw new Error('temporary object-store outage');
        }

        return true;
      }
    };
    const store = new InMemoryVfsBlobCommitStore(transientObjectStore);

    store.stage({
      stagingId: 'stage-10',
      blobId: 'blob-10',
      stagedBy: 'user-10',
      stagedAt: '2026-02-14T16:00:00.000Z',
      expiresAt: '2026-02-14T16:30:00.000Z'
    });

    const unavailableAttach = store.attach({
      stagingId: 'stage-10',
      attachedBy: 'user-10',
      itemId: 'email-10',
      attachedAt: '2026-02-14T16:05:00.000Z'
    });
    expect(unavailableAttach.status).toBe('unavailable');
    expect(store.get('stage-10')?.status).toBe('staged');
    expect(store.get('stage-10')?.attachedItemId).toBeNull();

    const retryAttach = store.attach({
      stagingId: 'stage-10',
      attachedBy: 'user-10',
      itemId: 'email-10',
      attachedAt: '2026-02-14T16:05:01.000Z'
    });
    expect(retryAttach.status).toBe('applied');
    expect(store.get('stage-10')).toEqual({
      stagingId: 'stage-10',
      blobId: 'blob-10',
      stagedBy: 'user-10',
      status: 'attached',
      stagedAt: '2026-02-14T16:00:00.000Z',
      expiresAt: '2026-02-14T16:30:00.000Z',
      attachedAt: '2026-02-14T16:05:01.000Z',
      attachedItemId: 'email-10'
    });
  });
});
