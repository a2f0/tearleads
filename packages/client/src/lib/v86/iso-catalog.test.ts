import { describe, expect, it } from 'vitest';
import { getIsoCatalogEntry, ISO_CATALOG } from './iso-catalog';

describe('getIsoCatalogEntry', () => {
  it('returns a catalog entry by id', () => {
    const entry = getIsoCatalogEntry(ISO_CATALOG[0]?.id ?? '');

    expect(entry?.id).toBe(ISO_CATALOG[0]?.id);
  });

  it('returns undefined for unknown ids', () => {
    expect(getIsoCatalogEntry('missing-id')).toBeUndefined();
  });
});
