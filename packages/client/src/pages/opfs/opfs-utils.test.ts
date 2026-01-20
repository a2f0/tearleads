import { describe, expect, it } from 'vitest';
import { calculateTotalSize, collectAllPaths, countFiles } from './opfs-utils';
import type { FileSystemEntry } from './types';

describe('opfs-utils', () => {
  describe('calculateTotalSize', () => {
    it('returns 0 for empty array', () => {
      expect(calculateTotalSize([])).toBe(0);
    });

    it('sums file sizes', () => {
      const entries: FileSystemEntry[] = [
        { name: 'file1.txt', kind: 'file', size: 100 },
        { name: 'file2.txt', kind: 'file', size: 200 }
      ];
      expect(calculateTotalSize(entries)).toBe(300);
    });

    it('recurses into directories with children', () => {
      const entries: FileSystemEntry[] = [
        {
          name: 'folder',
          kind: 'directory',
          children: [{ name: 'file.txt', kind: 'file', size: 50 }]
        }
      ];
      expect(calculateTotalSize(entries)).toBe(50);
    });

    it('returns total unchanged for directory without children', () => {
      const entries: FileSystemEntry[] = [
        { name: 'emptyFolder', kind: 'directory' }
      ];
      expect(calculateTotalSize(entries)).toBe(0);
    });
  });

  describe('countFiles', () => {
    it('returns 0 for empty array', () => {
      expect(countFiles([])).toBe(0);
    });

    it('counts files', () => {
      const entries: FileSystemEntry[] = [
        { name: 'file1.txt', kind: 'file', size: 100 },
        { name: 'file2.txt', kind: 'file', size: 200 }
      ];
      expect(countFiles(entries)).toBe(2);
    });

    it('recurses into directories with children', () => {
      const entries: FileSystemEntry[] = [
        {
          name: 'folder',
          kind: 'directory',
          children: [
            { name: 'file1.txt', kind: 'file', size: 50 },
            { name: 'file2.txt', kind: 'file', size: 60 }
          ]
        }
      ];
      expect(countFiles(entries)).toBe(2);
    });

    it('returns count unchanged for directory without children', () => {
      const entries: FileSystemEntry[] = [
        { name: 'emptyFolder', kind: 'directory' }
      ];
      expect(countFiles(entries)).toBe(0);
    });
  });

  describe('collectAllPaths', () => {
    it('returns empty for empty array', () => {
      expect(collectAllPaths([], '')).toEqual([]);
    });

    it('collects directory paths', () => {
      const entries: FileSystemEntry[] = [
        { name: 'folder1', kind: 'directory', children: [] },
        { name: 'folder2', kind: 'directory', children: [] }
      ];
      expect(collectAllPaths(entries, '')).toEqual(['/folder1', '/folder2']);
    });

    it('ignores files', () => {
      const entries: FileSystemEntry[] = [
        { name: 'file.txt', kind: 'file', size: 100 }
      ];
      expect(collectAllPaths(entries, '')).toEqual([]);
    });

    it('recurses into nested directories', () => {
      const entries: FileSystemEntry[] = [
        {
          name: 'parent',
          kind: 'directory',
          children: [{ name: 'child', kind: 'directory', children: [] }]
        }
      ];
      expect(collectAllPaths(entries, '')).toEqual([
        '/parent',
        '/parent/child'
      ]);
    });
  });
});
