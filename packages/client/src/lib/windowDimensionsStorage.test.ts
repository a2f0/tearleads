import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllWindowDimensions,
  clearWindowDimensions,
  loadWindowDimensions,
  saveWindowDimensions
} from './windowDimensionsStorage';

describe('windowDimensionsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('innerWidth', 1920);
    vi.stubGlobal('innerHeight', 1080);
  });

  describe('saveWindowDimensions', () => {
    it('saves dimensions to localStorage', () => {
      saveWindowDimensions('audio', { width: 400, height: 300, x: 100, y: 50 });

      const stored = localStorage.getItem('window-dimensions:audio');
      expect(stored).not.toBeNull();
      expect(stored && JSON.parse(stored)).toEqual({
        width: 400,
        height: 300,
        x: 100,
        y: 50
      });
    });

    it('overwrites existing dimensions', () => {
      saveWindowDimensions('photos', {
        width: 400,
        height: 300,
        x: 100,
        y: 50
      });
      saveWindowDimensions('photos', {
        width: 500,
        height: 400,
        x: 200,
        y: 100
      });

      const stored = localStorage.getItem('window-dimensions:photos');
      expect(stored && JSON.parse(stored)).toEqual({
        width: 500,
        height: 400,
        x: 200,
        y: 100
      });
    });

    it('handles localStorage errors gracefully', () => {
      const mockSetItem = vi.spyOn(Storage.prototype, 'setItem');
      mockSetItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() =>
        saveWindowDimensions('files', { width: 400, height: 300, x: 0, y: 0 })
      ).not.toThrow();

      mockSetItem.mockRestore();
    });
  });

  describe('loadWindowDimensions', () => {
    it('returns null when no dimensions are saved', () => {
      const result = loadWindowDimensions('audio');
      expect(result).toBeNull();
    });

    it('loads saved dimensions', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 100, y: 50 })
      );

      const result = loadWindowDimensions('audio');
      expect(result).toEqual({ width: 400, height: 300, x: 100, y: 50 });
    });

    it('constrains x position to viewport', () => {
      vi.stubGlobal('innerWidth', 800);
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 1000, y: 50 })
      );

      const result = loadWindowDimensions('audio');
      expect(result?.x).toBe(400); // 800 - 400 = 400 max x
    });

    it('constrains y position to viewport', () => {
      vi.stubGlobal('innerHeight', 600);
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 100, y: 500 })
      );

      const result = loadWindowDimensions('audio');
      expect(result?.y).toBe(300); // 600 - 300 = 300 max y
    });

    it('ensures minimum dimensions', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 50, height: 50, x: 0, y: 0 })
      );

      const result = loadWindowDimensions('audio');
      // Matches FloatingWindow default minimums
      expect(result?.width).toBe(300);
      expect(result?.height).toBe(200);
    });

    it('returns null for invalid JSON', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('window-dimensions:audio', 'invalid json');
      const result = loadWindowDimensions('audio');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to load window dimensions:',
        expect.any(SyntaxError)
      );
      warnSpy.mockRestore();
    });

    it('returns null for missing required fields', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400 })
      );
      const result = loadWindowDimensions('audio');
      expect(result).toBeNull();
    });

    it('returns null for non-numeric fields', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 'large', height: 300, x: 0, y: 0 })
      );
      const result = loadWindowDimensions('audio');
      expect(result).toBeNull();
    });
  });

  describe('clearWindowDimensions', () => {
    it('removes stored dimensions for a window type', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 0, y: 0 })
      );

      clearWindowDimensions('audio');

      expect(localStorage.getItem('window-dimensions:audio')).toBeNull();
    });

    it('does not affect other window types', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 0, y: 0 })
      );
      localStorage.setItem(
        'window-dimensions:photos',
        JSON.stringify({ width: 500, height: 400, x: 100, y: 100 })
      );

      clearWindowDimensions('audio');

      expect(localStorage.getItem('window-dimensions:photos')).not.toBeNull();
    });
  });

  describe('clearAllWindowDimensions', () => {
    it('removes all window dimension entries', () => {
      localStorage.setItem(
        'window-dimensions:audio',
        JSON.stringify({ width: 400, height: 300, x: 0, y: 0 })
      );
      localStorage.setItem(
        'window-dimensions:photos',
        JSON.stringify({ width: 500, height: 400, x: 100, y: 100 })
      );
      localStorage.setItem('other-key', 'other-value');

      clearAllWindowDimensions();

      expect(localStorage.getItem('window-dimensions:audio')).toBeNull();
      expect(localStorage.getItem('window-dimensions:photos')).toBeNull();
      expect(localStorage.getItem('other-key')).toBe('other-value');
    });
  });
});
