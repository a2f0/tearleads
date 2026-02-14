import { describe, expect, it } from 'vitest';
import {
  type AttachVfsBlobInput,
  InMemoryVfsBlobCommitStore,
  type VfsBlobCommitResult
} from './sync-blob-commit.js';

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
    const store = new InMemoryVfsBlobCommitStore();

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
    const store = new InMemoryVfsBlobCommitStore();
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
    const store = new InMemoryVfsBlobCommitStore();

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
    const store = new InMemoryVfsBlobCommitStore();

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
    const store = new InMemoryVfsBlobCommitStore();

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
});
