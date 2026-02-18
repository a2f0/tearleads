import { cn } from '@tearleads/ui';

export { cn };

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return formatDate(new Date(value));
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
