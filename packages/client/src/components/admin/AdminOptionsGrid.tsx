import { Database } from 'lucide-react';
import { GridSquare } from '@/components/ui/grid-square';
import { cn } from '@/lib/utils';

const ADMIN_OPTIONS = [
  { id: 'redis', label: 'Redis' },
  { id: 'postgres', label: 'Postgres' }
] as const;

export type AdminOptionId = (typeof ADMIN_OPTIONS)[number]['id'];

interface AdminOptionsGridProps {
  onSelect: (id: AdminOptionId) => void;
  gridClassName?: string;
}

export function AdminOptionsGrid({
  onSelect,
  gridClassName
}: AdminOptionsGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4',
        gridClassName
      )}
    >
      {ADMIN_OPTIONS.map((option) => (
        <GridSquare key={option.id} onClick={() => onSelect(option.id)}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <Database className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">
              {option.label}
            </span>
          </div>
        </GridSquare>
      ))}
    </div>
  );
}
