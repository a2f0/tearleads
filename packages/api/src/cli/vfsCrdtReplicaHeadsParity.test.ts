import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runVfsCrdtReplicaHeadsParity } from './vfsCrdtReplicaHeadsParity.js';

const mockGetPostgresPool = vi.fn();
const mockCheckVfsCrdtReplicaHeadsParity = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  closePostgresPool: vi.fn()
}));

vi.mock('../lib/vfsCrdtReplicaHeadsParity.js', () => ({
  checkVfsCrdtReplicaHeadsParity: (
    ...args: Parameters<typeof mockCheckVfsCrdtReplicaHeadsParity>
  ) => mockCheckVfsCrdtReplicaHeadsParity(...args),
  DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT: 100
}));

describe('runVfsCrdtReplicaHeadsParity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs parity checks with an explicit sample limit', async () => {
    const release = vi.fn();
    const client = { release };
    const connect = vi.fn().mockResolvedValue(client);
    mockGetPostgresPool.mockResolvedValue({ connect });
    mockCheckVfsCrdtReplicaHeadsParity.mockResolvedValue({
      checkedPairCount: 3,
      mismatchCount: 1,
      missingHeadCount: 1,
      staleHeadCount: 0,
      writeIdMismatchCount: 0,
      occurredAtMismatchCount: 0,
      sampleLimit: 5,
      sampledMismatchCount: 1,
      mismatches: []
    });

    const result = await runVfsCrdtReplicaHeadsParity({
      sampleLimit: '5'
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(mockCheckVfsCrdtReplicaHeadsParity).toHaveBeenCalledWith(client, {
      sampleLimit: 5
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.mismatchCount).toBe(1);
  });

  it('uses the default sample limit when omitted', async () => {
    const release = vi.fn();
    const client = { release };
    mockGetPostgresPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(client)
    });
    mockCheckVfsCrdtReplicaHeadsParity.mockResolvedValue({
      checkedPairCount: 0,
      mismatchCount: 0,
      missingHeadCount: 0,
      staleHeadCount: 0,
      writeIdMismatchCount: 0,
      occurredAtMismatchCount: 0,
      sampleLimit: 100,
      sampledMismatchCount: 0,
      mismatches: []
    });

    await runVfsCrdtReplicaHeadsParity({});

    expect(mockCheckVfsCrdtReplicaHeadsParity).toHaveBeenCalledWith(client, {
      sampleLimit: 100
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid sample-limit values', async () => {
    await expect(
      runVfsCrdtReplicaHeadsParity({ sampleLimit: '-1' })
    ).rejects.toThrow('sample-limit must be a non-negative integer');
    expect(mockGetPostgresPool).not.toHaveBeenCalled();
  });
});
