import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InfoRowProps {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}

export function InfoRow({ label, value, valueClassName }: InfoRowProps) {
  return (
    <div className="flex gap-1 text-sm">
      <span className="shrink-0 font-medium">{label}: </span>
      <span
        className={cn(
          'wrap-break-word min-w-0 text-muted-foreground',
          valueClassName
        )}
      >
        {value}
      </span>
    </div>
  );
}
