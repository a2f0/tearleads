import { describe, expect, it } from 'vitest';
import { groupByObjectType } from './vfsNameLookup';

describe('groupByObjectType', () => {
  it('groups rows by their objectType', () => {
    const rows = [
      { id: 'f1', objectType: 'file' },
      { id: 'f2', objectType: 'file' },
      { id: 'c1', objectType: 'contact' },
      { id: 'n1', objectType: 'note' }
    ];

    const result = groupByObjectType(rows);

    expect(result).toEqual({
      file: ['f1', 'f2'],
      contact: ['c1'],
      note: ['n1']
    });
  });

  it('returns empty object for empty input', () => {
    const result = groupByObjectType([]);

    expect(result).toEqual({});
  });

  it('handles single item', () => {
    const rows = [{ id: 'folder-1', objectType: 'folder' }];

    const result = groupByObjectType(rows);

    expect(result).toEqual({ folder: ['folder-1'] });
  });

  it('handles all same type', () => {
    const rows = [
      { id: 'p1', objectType: 'photo' },
      { id: 'p2', objectType: 'photo' },
      { id: 'p3', objectType: 'photo' }
    ];

    const result = groupByObjectType(rows);

    expect(result).toEqual({ photo: ['p1', 'p2', 'p3'] });
  });

  it('handles all different types', () => {
    const rows = [
      { id: '1', objectType: 'file' },
      { id: '2', objectType: 'photo' },
      { id: '3', objectType: 'contact' },
      { id: '4', objectType: 'note' },
      { id: '5', objectType: 'folder' }
    ];

    const result = groupByObjectType(rows);

    expect(Object.keys(result)).toHaveLength(5);
    expect(result['file']).toEqual(['1']);
    expect(result['photo']).toEqual(['2']);
    expect(result['contact']).toEqual(['3']);
    expect(result['note']).toEqual(['4']);
    expect(result['folder']).toEqual(['5']);
  });

  it('preserves order within groups', () => {
    const rows = [
      { id: 'first', objectType: 'file' },
      { id: 'second', objectType: 'file' },
      { id: 'third', objectType: 'file' }
    ];

    const result = groupByObjectType(rows);

    expect(result['file']).toEqual(['first', 'second', 'third']);
  });
});
