import { describe, expect, it } from 'vitest';
import { sortVfsItems } from './vfsSorting';
import type { VfsItemBase } from './vfsTypes';

describe('sortVfsItems', () => {
  it('sorts folders before other items', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'file', name: 'A File', createdAt: new Date() },
      {
        id: '2',
        objectType: 'folder',
        name: 'Z Folder',
        createdAt: new Date()
      },
      {
        id: '3',
        objectType: 'contact',
        name: 'B Contact',
        createdAt: new Date()
      }
    ];

    sortVfsItems(items);

    expect(items[0]?.objectType).toBe('folder');
    expect(items[0]?.name).toBe('Z Folder');
  });

  it('sorts items alphabetically by name within same type category', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'file', name: 'Zebra', createdAt: new Date() },
      { id: '2', objectType: 'file', name: 'Apple', createdAt: new Date() },
      { id: '3', objectType: 'file', name: 'Mango', createdAt: new Date() }
    ];

    sortVfsItems(items);

    expect(items.map((i) => i.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('sorts folders alphabetically among themselves', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'folder', name: 'Zebra', createdAt: new Date() },
      { id: '2', objectType: 'folder', name: 'Alpha', createdAt: new Date() },
      { id: '3', objectType: 'file', name: 'Beta', createdAt: new Date() }
    ];

    sortVfsItems(items);

    expect(items[0]?.name).toBe('Alpha');
    expect(items[1]?.name).toBe('Zebra');
    expect(items[2]?.name).toBe('Beta');
  });

  it('handles empty array', () => {
    const items: VfsItemBase[] = [];

    const result = sortVfsItems(items);

    expect(result).toEqual([]);
  });

  it('handles single item', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'file', name: 'Only One', createdAt: new Date() }
    ];

    sortVfsItems(items);

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Only One');
  });

  it('returns the same array reference (mutates in place)', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'file', name: 'B', createdAt: new Date() },
      { id: '2', objectType: 'file', name: 'A', createdAt: new Date() }
    ];

    const result = sortVfsItems(items);

    expect(result).toBe(items);
  });

  it('uses locale-aware string comparison', () => {
    const items: VfsItemBase[] = [
      { id: '1', objectType: 'file', name: 'äpple', createdAt: new Date() },
      { id: '2', objectType: 'file', name: 'apple', createdAt: new Date() },
      { id: '3', objectType: 'file', name: 'banana', createdAt: new Date() }
    ];

    sortVfsItems(items);

    // Locale comparison puts accented characters appropriately
    expect(items[0]?.name).toBe('apple');
    expect(items[1]?.name).toBe('äpple');
    expect(items[2]?.name).toBe('banana');
  });
});
