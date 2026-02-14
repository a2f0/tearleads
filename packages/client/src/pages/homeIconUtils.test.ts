import { describe, expect, it, vi } from 'vitest';
import { navItems } from '@/components/sidebar/navItems';
import {
  boxIntersectsIcon,
  calculateClusterPositions,
  calculateGridPositions,
  calculateScatterPositions,
  constrainAllPositions,
  constrainPosition,
  GAP,
  getGapForMobile,
  getIconButtonMeasurements,
  getIconSizeForMobile,
  getIconStyleClasses,
  getItemHeightForMobile,
  getItemsToArrange,
  ICON_LABEL_GAP,
  ICON_SIZE,
  ITEM_HEIGHT,
  positionsAreEqual,
  resolveOverlaps
} from './homeIconUtils';

describe('homeIconUtils', () => {
  it('returns icon styles for transparent, debossed, and default modes', () => {
    expect(getIconStyleClasses('embossed', 'transparent')).toEqual({
      iconBgClasses: 'bg-transparent',
      iconFgClass: 'text-foreground'
    });

    expect(getIconStyleClasses('debossed', 'colored')).toEqual({
      iconBgClasses:
        'bg-primary-foreground from-primary-foreground/80 to-primary-foreground',
      iconFgClass: 'text-primary'
    });

    expect(getIconStyleClasses('embossed', 'colored')).toEqual({
      iconBgClasses: 'bg-primary from-primary/80 to-primary',
      iconFgClass: 'text-primary-foreground'
    });
  });

  it('filters items only when selected paths are provided', () => {
    const items = navItems.slice(0, 3);
    expect(getItemsToArrange(items)).toEqual(items);
    expect(getItemsToArrange(items, new Set([items[1]?.path ?? '']))).toEqual([
      items[1]
    ]);
  });

  it('compares position maps by keys and coordinates', () => {
    const p1 = {
      '/a': { x: 10, y: 20 },
      '/b': { x: 30, y: 40 }
    };
    const p2 = {
      '/a': { x: 10, y: 20 },
      '/b': { x: 30, y: 40 }
    };
    const p3 = { '/a': { x: 10, y: 20 } };
    const p4 = {
      '/a': { x: 10, y: 21 },
      '/b': { x: 30, y: 40 }
    };

    expect(positionsAreEqual(p1, p2)).toBe(true);
    expect(positionsAreEqual(p1, p3)).toBe(false);
    expect(positionsAreEqual(p1, p4)).toBe(false);
  });

  it('returns original positions when container is too small to constrain', () => {
    const input = { '/a': { x: 0, y: 0 } };
    const result = resolveOverlaps(input, 10, 10, ICON_SIZE, ITEM_HEIGHT);
    expect(result).toBe(input);
  });

  it('resolves overlapping positions by moving later items', () => {
    const input = {
      '/a': { x: 0, y: 0 },
      '/b': { x: 0, y: 0 }
    };

    const result = resolveOverlaps(input, 300, 300, ICON_SIZE, 16);
    expect(result['/a']).toEqual({ x: 0, y: 0 });
    expect(result['/b']).toBeDefined();
    expect(result['/b']).not.toEqual({ x: 0, y: 0 });
  });

  it('constrains a single position to container bounds', () => {
    expect(
      constrainPosition({ x: -5, y: 999 }, 200, 200, ICON_SIZE, 16)
    ).toEqual({
      x: 0,
      y: 112
    });
  });

  it('constrains and de-overlaps all positions', () => {
    const result = constrainAllPositions(
      {
        '/a': { x: -10, y: -10 },
        '/b': { x: -10, y: -10 }
      },
      300,
      300,
      ICON_SIZE,
      16
    );

    expect(result['/a']).toEqual({ x: 0, y: 0 });
    expect(result['/b']).toBeDefined();
    expect(result['/b']).not.toEqual({ x: 0, y: 0 });
  });

  it('calculates grid positions and preserves unselected current positions', () => {
    const items = navItems.slice(0, 3);
    const current = {
      [items[0]?.path ?? '/x']: { x: 5, y: 5 },
      [items[1]?.path ?? '/y']: { x: 9, y: 9 },
      [items[2]?.path ?? '/z']: { x: 20, y: 30 }
    };
    const selected = new Set([items[0]?.path ?? '']);

    const result = calculateGridPositions(items, 300, false, selected, current);

    expect(result[items[1]?.path ?? '/y']).toEqual({ x: 9, y: 9 });
    expect(result[items[2]?.path ?? '/z']).toEqual({ x: 20, y: 30 });
    expect(result[items[0]?.path ?? '/x']?.x).not.toBe(5);
    expect(result[items[0]?.path ?? '/x']?.y).toBe(0);
  });

  it('calculates scatter positions using constrained random values', () => {
    const items = navItems.slice(0, 2);
    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.5);
    randomSpy.mockReturnValueOnce(0.25);

    const result = calculateScatterPositions(items, 300, 400, false);
    randomSpy.mockRestore();

    expect(result[items[0]?.path ?? '/x']).toEqual({ x: 118, y: 78 });
  });

  it('detects intersections regardless of drag direction', () => {
    const iconPos = { x: 20, y: 20 };
    expect(
      boxIntersectsIcon(
        { startX: 10, startY: 10, endX: 30, endY: 30 },
        iconPos,
        16,
        24
      )
    ).toBe(true);
    expect(
      boxIntersectsIcon(
        { startX: 30, startY: 30, endX: 10, endY: 10 },
        iconPos,
        16,
        24
      )
    ).toBe(true);
    expect(
      boxIntersectsIcon(
        { startX: 0, startY: 0, endX: 5, endY: 5 },
        iconPos,
        16,
        24
      )
    ).toBe(false);
  });

  it('calculates centered cluster positions with per-item size offsets', () => {
    const items = navItems.slice(0, 2);
    const result = calculateClusterPositions(
      items,
      400,
      300,
      false,
      undefined,
      undefined,
      100,
      120,
      {
        [items[0]?.path ?? '/x']: 100,
        [items[1]?.path ?? '/y']: 120
      },
      {
        [items[0]?.path ?? '/x']: 80,
        [items[1]?.path ?? '/y']: 100
      }
    );

    expect(result[items[0]?.path ?? '/x']).toEqual({ x: 90, y: 100 });
    expect(result[items[1]?.path ?? '/y']).toEqual({ x: 220, y: 90 });
  });

  it('measures icon buttons and ignores unrelated buttons', () => {
    const container = document.createElement('div');
    const includedPath = navItems[0]?.path ?? '/camera';
    const excludedPath = '/not-included';

    const included = document.createElement('button');
    included.dataset['iconPath'] = includedPath;
    Object.defineProperty(included, 'offsetWidth', {
      configurable: true,
      value: 0
    });
    Object.defineProperty(included, 'offsetHeight', {
      configurable: true,
      value: 0
    });
    Object.defineProperty(included, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 0, 100.2, 49.1)
    });

    const excluded = document.createElement('button');
    excluded.dataset['iconPath'] = excludedPath;
    Object.defineProperty(excluded, 'offsetWidth', {
      configurable: true,
      value: 200
    });
    Object.defineProperty(excluded, 'offsetHeight', {
      configurable: true,
      value: 200
    });

    container.appendChild(included);
    container.appendChild(excluded);

    const result = getIconButtonMeasurements(container, [includedPath]);
    expect(result).toEqual({
      maxWidth: 101,
      maxHeight: 50,
      itemHeights: { [includedPath]: 49.1 },
      itemWidths: { [includedPath]: 100.2 }
    });
  });

  it('returns null measurement for empty or zero-sized button sets', () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    button.dataset['iconPath'] = navItems[0]?.path ?? '/camera';
    Object.defineProperty(button, 'offsetWidth', {
      configurable: true,
      value: 0
    });
    Object.defineProperty(button, 'offsetHeight', {
      configurable: true,
      value: 0
    });
    container.appendChild(button);

    expect(
      getIconButtonMeasurements(null, [navItems[0]?.path ?? '/camera'])
    ).toBe(null);
    expect(getIconButtonMeasurements(container, [])).toBe(null);
    expect(
      getIconButtonMeasurements(container, [navItems[0]?.path ?? '/camera'])
    ).toBe(null);
  });

  it('returns mobile and desktop size constants', () => {
    expect(getIconSizeForMobile(false)).toBe(ICON_SIZE);
    expect(getIconSizeForMobile(true)).toBe(56);
    expect(getItemHeightForMobile(false)).toBe(ITEM_HEIGHT);
    expect(getItemHeightForMobile(true)).toBe(56 + 16 + ICON_LABEL_GAP);
    expect(getGapForMobile(false)).toBe(GAP);
    expect(getGapForMobile(true)).toBe(28);
  });
});
