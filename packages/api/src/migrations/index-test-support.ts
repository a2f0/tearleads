import type { Pool } from 'pg';
import { vi } from 'vitest';
import { migrations } from './index.js';

export { migrations };

export interface MockQueryResult {
  rows: Array<{ version: number | null }>;
  rowCount: number;
}

export function createMockPool(
  queryResponses: Map<string, MockQueryResult>
): Pool & { queries: string[] } {
  const queries: string[] = [];

  return {
    queries,
    query: vi.fn().mockImplementation((sql: string) => {
      queries.push(sql);

      for (const [pattern, response] of queryResponses.entries()) {
        if (sql.includes(pattern)) {
          return Promise.resolve(response);
        }
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    })
  } as unknown as Pool & { queries: string[] };
}
