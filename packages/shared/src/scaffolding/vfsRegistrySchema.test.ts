import { describe, expect, it, vi } from 'vitest';
import { hasVfsRegistryOrganizationId } from './vfsRegistrySchema.js';

describe('hasVfsRegistryOrganizationId', () => {
  it('returns true when selecting organization_id succeeds', async () => {
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
    expect(sql).toContain('SELECT organization_id FROM vfs_registry LIMIT 0');
  });

  it('returns false when selecting organization_id fails', async () => {
    const query = vi.fn(async () => {
      throw new Error('column "organization_id" does not exist');
    });

    const result = await hasVfsRegistryOrganizationId({
      query
    });

    expect(result).toBe(false);
  });
});
