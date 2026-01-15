export const SCATTER_DOT_RADIUS = 3;

const CHART_COLOR_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8'
] as const;

/**
 * Gets the chart colors from CSS custom properties.
 * Must be called in a component/hook context where the DOM is available.
 */
export function getChartColors(): string[] {
  if (typeof document === 'undefined') {
    // Use distinct, evenly distributed grayscale values for SSR fallback
    return [
      '#505050',
      '#606060',
      '#707070',
      '#808080',
      '#909090',
      '#a0a0a0',
      '#b0b0b0',
      '#c0c0c0'
    ];
  }

  const style = getComputedStyle(document.documentElement);
  return CHART_COLOR_VARS.map((varName) => {
    const value = style.getPropertyValue(varName).trim();
    return value || '#808080';
  });
}
