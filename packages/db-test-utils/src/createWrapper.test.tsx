import type { Database } from '@tearleads/db/sqlite';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  composeWrappers,
  createRealDbWrapper,
  useTestDb
} from './createWrapper.js';

describe('createRealDbWrapper', () => {
  it('creates a wrapper component', () => {
    const mockDb = {} as Database;
    const Wrapper = createRealDbWrapper(mockDb);
    expect(typeof Wrapper).toBe('function');
  });

  it('provides database through context', () => {
    const mockDb = { mock: true } as unknown as Database;

    const { result } = renderHook(() => useTestDb(), {
      wrapper: createRealDbWrapper(mockDb)
    });

    expect(result.current).toBe(mockDb);
  });
});

describe('useTestDb', () => {
  it('throws when used outside wrapper', () => {
    expect(() => {
      renderHook(() => useTestDb());
    }).toThrow('useTestDb must be used within createRealDbWrapper');
  });

  it('returns database when inside wrapper', () => {
    const mockDb = { test: 'db' } as unknown as Database;

    const { result } = renderHook(() => useTestDb(), {
      wrapper: createRealDbWrapper(mockDb)
    });

    expect(result.current).toBe(mockDb);
  });
});

describe('composeWrappers', () => {
  it('composes single wrapper', () => {
    const mockDb = {} as Database;
    const composed = composeWrappers(createRealDbWrapper(mockDb));

    const { result } = renderHook(() => useTestDb(), { wrapper: composed });

    expect(result.current).toBe(mockDb);
  });

  it('composes multiple wrappers', () => {
    const mockDb = {} as Database;

    let outerRendered = false;
    const OuterWrapper = ({ children }: { children: React.ReactNode }) => {
      outerRendered = true;
      return <>{children}</>;
    };

    const composed = composeWrappers(createRealDbWrapper(mockDb), OuterWrapper);

    const { result } = renderHook(() => useTestDb(), { wrapper: composed });

    expect(result.current).toBe(mockDb);
    expect(outerRendered).toBe(true);
  });

  it('applies wrappers in correct order (right to left)', () => {
    const order: string[] = [];

    const Wrapper1 = ({ children }: { children: React.ReactNode }) => {
      order.push('1');
      return <>{children}</>;
    };

    const Wrapper2 = ({ children }: { children: React.ReactNode }) => {
      order.push('2');
      return <>{children}</>;
    };

    const composed = composeWrappers(Wrapper1, Wrapper2);

    renderHook(() => null, { wrapper: composed });

    // reduceRight means Wrapper2 is innermost, Wrapper1 is outermost
    // So Wrapper1 renders first, then Wrapper2
    expect(order).toEqual(['1', '2']);
  });
});
