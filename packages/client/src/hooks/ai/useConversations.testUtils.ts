import { vi } from 'vitest';

export function createChainableDb(selectResult: unknown[] = []) {
  const mockTx = {
    insert: vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi
        .fn()
        .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
  };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(selectResult)
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(selectResult),
          orderBy: vi.fn().mockResolvedValue(selectResult)
        }),
        orderBy: vi.fn().mockResolvedValue(selectResult)
      })
    }),
    insert: vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi
        .fn()
        .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    }),
    delete: vi
      .fn()
      .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx))
  };
}
