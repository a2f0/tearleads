import { describe, expect, it, vi } from 'vitest';
import { getChartColors } from './constants';

describe('getChartColors', () => {
  it('returns fallback grayscale colors when document is unavailable', () => {
    const documentSpy = vi
      .spyOn(globalThis, 'document', 'get')
      .mockReturnValue(undefined as unknown as Document);

    expect(getChartColors()).toEqual([
      '#505050',
      '#606060',
      '#707070',
      '#808080',
      '#909090',
      '#a0a0a0',
      '#b0b0b0',
      '#c0c0c0'
    ]);

    documentSpy.mockRestore();
  });

  it('reads theme chart variables from CSS custom properties', () => {
    const getComputedStyleSpy = vi
      .spyOn(globalThis, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: (name: string) => {
          if (name === '--chart-1') return '#111111';
          if (name === '--chart-2') return '#222222';
          return '';
        }
      } as CSSStyleDeclaration);

    expect(getChartColors()).toEqual([
      '#111111',
      '#222222',
      '#808080',
      '#808080',
      '#808080',
      '#808080',
      '#808080',
      '#808080'
    ]);

    getComputedStyleSpy.mockRestore();
  });
});
