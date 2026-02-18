import { cn } from '@tearleads/ui';

export { cn };

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatTimestamp(value: string | number | Date): string {
  return new Date(value).toLocaleString();
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString();
}
