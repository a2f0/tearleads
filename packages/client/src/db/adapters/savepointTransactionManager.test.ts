import { describe, expect, it, vi } from 'vitest';
import { SavepointTransactionManager } from './savepointTransactionManager';

describe('SavepointTransactionManager', () => {
  it('begins and commits a root transaction when none is active', async () => {
    const beginRoot = vi.fn(async () => undefined);
    const commitRoot = vi.fn(async () => undefined);
    const rollbackRoot = vi.fn(async () => undefined);
    const executeSql = vi.fn(async (_sql: string) => undefined);
    const isRootTransactionActive = vi.fn(async () => false);

    const manager = new SavepointTransactionManager(
      {
        beginRoot,
        commitRoot,
        rollbackRoot,
        executeSql,
        isRootTransactionActive
      },
      'sp_test_tx'
    );

    await manager.begin();
    await manager.commit();

    expect(beginRoot).toHaveBeenCalledTimes(1);
    expect(commitRoot).toHaveBeenCalledTimes(1);
    expect(executeSql).not.toHaveBeenCalled();
  });

  it('uses savepoints for nested begin/commit calls', async () => {
    const beginRoot = vi.fn(async () => undefined);
    const commitRoot = vi.fn(async () => undefined);
    const rollbackRoot = vi.fn(async () => undefined);
    const executeSql = vi.fn(async (_sql: string) => undefined);
    const isRootTransactionActive = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const manager = new SavepointTransactionManager(
      {
        beginRoot,
        commitRoot,
        rollbackRoot,
        executeSql,
        isRootTransactionActive
      },
      'sp_test_tx'
    );

    await manager.begin();
    await manager.begin();
    await manager.commit();
    await manager.commit();

    expect(beginRoot).toHaveBeenCalledTimes(1);
    expect(commitRoot).toHaveBeenCalledTimes(1);
    expect(executeSql).toHaveBeenNthCalledWith(1, 'SAVEPOINT sp_test_tx_1');
    expect(executeSql).toHaveBeenNthCalledWith(2, 'RELEASE sp_test_tx_1');
  });

  it('uses savepoints for nested rollbacks', async () => {
    const beginRoot = vi.fn(async () => undefined);
    const commitRoot = vi.fn(async () => undefined);
    const rollbackRoot = vi.fn(async () => undefined);
    const executeSql = vi.fn(async (_sql: string) => undefined);
    const isRootTransactionActive = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const manager = new SavepointTransactionManager(
      {
        beginRoot,
        commitRoot,
        rollbackRoot,
        executeSql,
        isRootTransactionActive
      },
      'sp_test_tx'
    );

    await manager.begin();
    await manager.begin();
    await manager.rollback();

    expect(rollbackRoot).not.toHaveBeenCalled();
    expect(executeSql).toHaveBeenNthCalledWith(1, 'SAVEPOINT sp_test_tx_1');
    expect(executeSql).toHaveBeenNthCalledWith(2, 'ROLLBACK TO sp_test_tx_1');
    expect(executeSql).toHaveBeenNthCalledWith(3, 'RELEASE sp_test_tx_1');
  });

  it('throws when committing without an active transaction', async () => {
    const manager = new SavepointTransactionManager(
      {
        beginRoot: async () => undefined,
        commitRoot: async () => undefined,
        rollbackRoot: async () => undefined,
        executeSql: async (_sql: string) => undefined,
        isRootTransactionActive: async () => false
      },
      'sp_test_tx'
    );

    await expect(manager.commit()).rejects.toThrow(
      'No active transaction to commit'
    );
  });

  it('throws when rolling back without an active transaction', async () => {
    const manager = new SavepointTransactionManager(
      {
        beginRoot: async () => undefined,
        commitRoot: async () => undefined,
        rollbackRoot: async () => undefined,
        executeSql: async (_sql: string) => undefined,
        isRootTransactionActive: async () => false
      },
      'sp_test_tx'
    );

    await expect(manager.rollback()).rejects.toThrow(
      'No active transaction to rollback'
    );
  });

  it('serializes concurrent begin calls to avoid duplicate root transactions', async () => {
    let resolveRootBegin: (() => void) | undefined;
    const beginRoot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRootBegin = resolve;
        })
    );
    const commitRoot = vi.fn(async () => undefined);
    const rollbackRoot = vi.fn(async () => undefined);
    const executeSql = vi.fn(async (_sql: string) => undefined);
    const isRootTransactionActive = vi.fn(async () => false);

    const manager = new SavepointTransactionManager(
      {
        beginRoot,
        commitRoot,
        rollbackRoot,
        executeSql,
        isRootTransactionActive
      },
      'sp_test_tx'
    );

    const firstBegin = manager.begin();
    const secondBegin = manager.begin();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(beginRoot).toHaveBeenCalledTimes(1);

    resolveRootBegin?.();
    await firstBegin;
    await secondBegin;

    expect(beginRoot).toHaveBeenCalledTimes(1);
    expect(executeSql).toHaveBeenCalledWith('SAVEPOINT sp_test_tx_1');
  });

  it('reset clears nested and root transaction state', async () => {
    const beginRoot = vi.fn(async () => undefined);
    const commitRoot = vi.fn(async () => undefined);
    const rollbackRoot = vi.fn(async () => undefined);
    const executeSql = vi.fn(async (_sql: string) => undefined);
    const isRootTransactionActive = vi.fn(async () => false);

    const manager = new SavepointTransactionManager(
      {
        beginRoot,
        commitRoot,
        rollbackRoot,
        executeSql,
        isRootTransactionActive
      },
      'sp_test_tx'
    );

    await manager.begin();
    await manager.begin();
    manager.reset();
    await manager.begin();
    await manager.commit();

    expect(beginRoot).toHaveBeenCalledTimes(2);
    expect(commitRoot).toHaveBeenCalledTimes(1);
  });
});
