import { describe, expect, it } from 'vitest';
import {
  getGapForMobile,
  getIconSizeForMobile,
  getItemHeightForMobile,
  getMinSelectionDragDistance,
  getMobileGridTemplateColumns,
  positionsAreEqual
} from './desktopIconUtils';

describe('desktopIconUtils', () => {
  describe('getIconSizeForMobile', () => {
    it('returns 56 for mobile', () => {
      expect(getIconSizeForMobile(true)).toBe(56);
    });

    it('returns 64 for desktop', () => {
      expect(getIconSizeForMobile(false)).toBe(64);
    });
  });

  describe('getGapForMobile', () => {
    it('returns 28 for mobile', () => {
      expect(getGapForMobile(true)).toBe(28);
    });

    it('returns 40 for desktop', () => {
      expect(getGapForMobile(false)).toBe(40);
    });
  });

  describe('getItemHeightForMobile', () => {
    it('returns correct height for mobile', () => {
      expect(getItemHeightForMobile(true)).toBe(56 + 16 + 8);
    });

    it('returns correct height for desktop', () => {
      expect(getItemHeightForMobile(false)).toBe(64 + 16 + 8);
    });
  });

  describe('getMobileGridTemplateColumns', () => {
    it('returns 4 column grid template', () => {
      expect(getMobileGridTemplateColumns()).toBe('repeat(4, minmax(0, 1fr))');
    });
  });

  describe('getMinSelectionDragDistance', () => {
    it('returns selection drag threshold', () => {
      expect(getMinSelectionDragDistance()).toBe(5);
    });
  });

  describe('positionsAreEqual', () => {
    it('returns true for identical positions', () => {
      const p1 = { '/a': { x: 1, y: 2 }, '/b': { x: 3, y: 4 } };
      const p2 = { '/a': { x: 1, y: 2 }, '/b': { x: 3, y: 4 } };
      expect(positionsAreEqual(p1, p2)).toBe(true);
    });

    it('returns false for different key counts', () => {
      const p1 = { '/a': { x: 1, y: 2 } };
      const p2 = { '/a': { x: 1, y: 2 }, '/b': { x: 3, y: 4 } };
      expect(positionsAreEqual(p1, p2)).toBe(false);
    });

    it('returns false for different x values', () => {
      const p1 = { '/a': { x: 1, y: 2 } };
      const p2 = { '/a': { x: 99, y: 2 } };
      expect(positionsAreEqual(p1, p2)).toBe(false);
    });

    it('returns false for different y values', () => {
      const p1 = { '/a': { x: 1, y: 2 } };
      const p2 = { '/a': { x: 1, y: 99 } };
      expect(positionsAreEqual(p1, p2)).toBe(false);
    });

    it('returns false when key missing in p2', () => {
      const p1 = { '/a': { x: 1, y: 2 } };
      const p2 = { '/different': { x: 1, y: 2 } };
      expect(positionsAreEqual(p1, p2)).toBe(false);
    });

    it('returns true for empty positions', () => {
      expect(positionsAreEqual({}, {})).toBe(true);
    });
  });
});
