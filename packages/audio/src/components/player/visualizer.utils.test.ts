import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BAR_COUNT,
  BAR_KEYS,
  getStoredVisibility,
  HIGH_LEVEL_THRESHOLD,
  MEDIUM_LEVEL_THRESHOLD,
  SEGMENT_COUNT,
  SEGMENT_KEYS,
  SEGMENT_TOTAL_HEIGHT,
  STORAGE_KEY,
  setStoredVisibility,
  VISUALIZER_HEIGHT
} from './visualizer.utils';

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage
});

describe('visualizer.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
  });

  describe('constants', () => {
    it('exports correct storage key', () => {
      expect(STORAGE_KEY).toBe('audio-visualizer-visible');
    });

    it('exports correct bar count', () => {
      expect(BAR_COUNT).toBe(12);
    });

    it('exports correct segment count', () => {
      expect(SEGMENT_COUNT).toBe(15);
    });

    it('exports correct visualizer height', () => {
      expect(VISUALIZER_HEIGHT).toBe(SEGMENT_COUNT * SEGMENT_TOTAL_HEIGHT);
    });

    it('exports level thresholds', () => {
      expect(HIGH_LEVEL_THRESHOLD).toBe(0.8);
      expect(MEDIUM_LEVEL_THRESHOLD).toBe(0.6);
    });

    it('generates correct bar keys', () => {
      expect(BAR_KEYS).toHaveLength(BAR_COUNT);
      expect(BAR_KEYS[0]).toBe('bar-0');
      expect(BAR_KEYS[11]).toBe('bar-11');
    });

    it('generates correct segment keys', () => {
      expect(SEGMENT_KEYS).toHaveLength(SEGMENT_COUNT);
      expect(SEGMENT_KEYS[0]).toBe('seg-0');
      expect(SEGMENT_KEYS[14]).toBe('seg-14');
    });
  });

  describe('getStoredVisibility', () => {
    it('returns visible by default', () => {
      expect(getStoredVisibility()).toBe('visible');
    });

    it('returns stored visible value', () => {
      mockLocalStorage.getItem.mockReturnValue('visible');
      expect(getStoredVisibility()).toBe('visible');
    });

    it('returns stored hidden value', () => {
      mockLocalStorage.getItem.mockReturnValue('hidden');
      expect(getStoredVisibility()).toBe('hidden');
    });

    it('returns visible for invalid stored value', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid');
      expect(getStoredVisibility()).toBe('visible');
    });

    it('handles localStorage.getItem throwing', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage disabled');
      });
      expect(getStoredVisibility()).toBe('visible');
    });
  });

  describe('setStoredVisibility', () => {
    it('stores visible value', () => {
      setStoredVisibility('visible');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-visible',
        'visible'
      );
    });

    it('stores hidden value', () => {
      setStoredVisibility('hidden');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'audio-visualizer-visible',
        'hidden'
      );
    });

    it('handles localStorage.setItem throwing', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('localStorage disabled');
      });
      expect(() => setStoredVisibility('visible')).not.toThrow();
    });
  });
});
