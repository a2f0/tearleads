/**
 * Estimated height of a table row in pixels for virtualization.
 */
export const ROW_HEIGHT_ESTIMATE = 40;

/**
 * Mobile breakpoint in pixels.
 */
const MOBILE_BREAKPOINT = 640;

/**
 * Checks if the current viewport is mobile-sized.
 */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Formats a cell value for display.
 */
export function formatCellValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Generates a unique key for a row based on its index.
 */
export function getRowKey(index: number): string {
  return `idx-${index}`;
}

/**
 * Triggers a browser download of a file with given content.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
