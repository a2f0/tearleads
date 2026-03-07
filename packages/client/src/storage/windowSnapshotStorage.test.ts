import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllWindowSnapshots,
  clearWindowDimensionsForInstance,
  clearWindowSnapshot,
  loadWindowSnapshot,
  saveWindowSnapshot
} from './windowSnapshotStorage';

describe('windowSnapshotStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveWindowSnapshot / loadWindowSnapshot', () => {
    it('round-trips a window snapshot', () => {
      const windows = [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false },
        { id: 'w2', type: 'files', zIndex: 101, isMinimized: true }
      ];
      saveWindowSnapshot('instance-1', windows);
      const loaded = loadWindowSnapshot('instance-1');
      expect(loaded).toEqual(windows);
    });

    it('preserves dimensions in snapshot', () => {
      const windows = [
        {
          id: 'w1',
          type: 'notes',
          zIndex: 100,
          isMinimized: false,
          dimensions: { width: 800, height: 600, x: 50, y: 50 }
        }
      ];
      saveWindowSnapshot('instance-1', windows);
      const loaded = loadWindowSnapshot('instance-1');
      expect(loaded?.[0]?.dimensions).toEqual({
        width: 800,
        height: 600,
        x: 50,
        y: 50
      });
    });

    it('returns null for non-existent snapshot', () => {
      expect(loadWindowSnapshot('non-existent')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('window-snapshot:bad', 'not-json');
      expect(loadWindowSnapshot('bad')).toBeNull();
    });

    it('returns null for non-array stored data', () => {
      localStorage.setItem('window-snapshot:obj', JSON.stringify({ id: 'w1' }));
      expect(loadWindowSnapshot('obj')).toBeNull();
    });

    it('filters out invalid items in array', () => {
      const stored = [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false },
        { id: 123, type: 'notes', zIndex: 100, isMinimized: false },
        'invalid',
        null
      ];
      localStorage.setItem('window-snapshot:mixed', JSON.stringify(stored));
      const loaded = loadWindowSnapshot('mixed');
      expect(loaded).toEqual([
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
      ]);
    });

    it('returns null when all items are invalid', () => {
      localStorage.setItem(
        'window-snapshot:allbad',
        JSON.stringify([{ bad: true }, null])
      );
      expect(loadWindowSnapshot('allbad')).toBeNull();
    });

    it('handles localStorage errors gracefully on save', () => {
      const spy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('quota exceeded');
        });
      saveWindowSnapshot('instance-1', [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
      ]);
      spy.mockRestore();
    });

    it('handles localStorage errors gracefully on load', () => {
      const spy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('access denied');
        });
      expect(loadWindowSnapshot('instance-1')).toBeNull();
      spy.mockRestore();
    });
  });

  describe('clearWindowSnapshot', () => {
    it('removes a single instance snapshot', () => {
      saveWindowSnapshot('instance-1', [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
      ]);
      saveWindowSnapshot('instance-2', [
        { id: 'w2', type: 'files', zIndex: 100, isMinimized: false }
      ]);

      clearWindowSnapshot('instance-1');

      expect(loadWindowSnapshot('instance-1')).toBeNull();
      expect(loadWindowSnapshot('instance-2')).not.toBeNull();
    });
  });

  describe('clearWindowDimensionsForInstance', () => {
    it('removes scoped dimension keys for an instance', () => {
      localStorage.setItem(
        'window-dimensions:inst-1:notes',
        JSON.stringify({ width: 800, height: 600, x: 0, y: 0 })
      );
      localStorage.setItem(
        'window-dimensions:inst-1:files',
        JSON.stringify({ width: 400, height: 300, x: 10, y: 10 })
      );
      localStorage.setItem(
        'window-dimensions:inst-2:notes',
        JSON.stringify({ width: 500, height: 400, x: 20, y: 20 })
      );

      clearWindowDimensionsForInstance('inst-1');

      expect(localStorage.getItem('window-dimensions:inst-1:notes')).toBeNull();
      expect(localStorage.getItem('window-dimensions:inst-1:files')).toBeNull();
      expect(
        localStorage.getItem('window-dimensions:inst-2:notes')
      ).not.toBeNull();
    });
  });

  describe('clearAllWindowSnapshots', () => {
    it('removes all snapshot keys', () => {
      saveWindowSnapshot('instance-1', [
        { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
      ]);
      saveWindowSnapshot('instance-2', [
        { id: 'w2', type: 'files', zIndex: 100, isMinimized: false }
      ]);
      localStorage.setItem('other-key', 'preserved');

      clearAllWindowSnapshots();

      expect(loadWindowSnapshot('instance-1')).toBeNull();
      expect(loadWindowSnapshot('instance-2')).toBeNull();
      expect(localStorage.getItem('other-key')).toBe('preserved');
    });
  });
});
