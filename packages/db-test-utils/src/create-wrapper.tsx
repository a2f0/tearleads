/**
 * React wrapper factory for testing with real SQLite database.
 *
 * Creates a wrapper component that provides the database through context,
 * suitable for use with React Testing Library's renderHook and render.
 */

import type { Database } from '@tearleads/db/sqlite';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

interface TestDbContextValue {
  db: Database;
}

const TestDbContext = createContext<TestDbContextValue | null>(null);

/**
 * Creates a React wrapper for testing-library that provides the database.
 *
 * Use this with renderHook or render to provide database context to components.
 *
 * @example
 * ```tsx
 * import { withRealDatabase, createRealDbWrapper } from '@tearleads/db-test-utils';
 * import { renderHook } from '@testing-library/react';
 *
 * it('works with real database', async () => {
 *   await withRealDatabase(async ({ db }) => {
 *     const { result } = renderHook(() => useSomeHook(), {
 *       wrapper: createRealDbWrapper(db)
 *     });
 *
 *     // ... assertions
 *   });
 * });
 * ```
 */
export function createRealDbWrapper(db: Database) {
  return function TestDbWrapper({ children }: { children: ReactNode }) {
    return (
      <TestDbContext.Provider value={{ db }}>{children}</TestDbContext.Provider>
    );
  };
}

/**
 * Hook to access the test database context.
 *
 * Use this in hooks or components that need access to the database
 * when wrapped with createRealDbWrapper.
 *
 * @throws Error if used outside of createRealDbWrapper
 */
export function useTestDb(): Database {
  const context = useContext(TestDbContext);
  if (!context) {
    throw new Error('useTestDb must be used within createRealDbWrapper');
  }
  return context.db;
}

/**
 * Composable wrapper utility for combining multiple providers.
 *
 * Use this when you need to combine the database wrapper with other providers.
 *
 * @example
 * ```tsx
 * const wrapper = composeWrappers(
 *   createRealDbWrapper(db),
 *   ({ children }) => <SomeOtherProvider>{children}</SomeOtherProvider>
 * );
 *
 * const { result } = renderHook(() => useSomeHook(), { wrapper });
 * ```
 */
export function composeWrappers(
  ...wrappers: Array<({ children }: { children: ReactNode }) => ReactNode>
): ({ children }: { children: ReactNode }) => ReactNode {
  return ({ children }: { children: ReactNode }) => {
    return wrappers.reduceRight(
      // biome-ignore lint/suspicious/noArrayIndexKey: Static wrapper list doesn't reorder
      (acc, Wrapper, index) => <Wrapper key={index}>{acc}</Wrapper>,
      children
    );
  };
}
