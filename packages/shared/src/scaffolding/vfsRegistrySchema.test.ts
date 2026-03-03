import { describe, expect, it, vi } from 'vitest';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';

describe('hasVfsRegistryOrganizationId', () => {
  it('queries across current search path schemas', async () => {
    const query = vi.fn(
      async (_text: string, _params?: readonly unknown[]) => ({
        rows: [{ '?column?': 1 }]
      })
    );

    const result = await hasVfsRegistryOrganizationId({
      query
    });

    expect(result).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('table_schema = ANY(current_schemas(false))');
  });

  it('returns false when no organization_id column exists', async () => {
    const query = vi.fn(
      async (_text: string, _params?: readonly unknown[]) => ({ rows: [] })
    );

    const result = await hasVfsRegistryOrganizationId({
      query
    });

    expect(result).toBe(false);
  });
});
