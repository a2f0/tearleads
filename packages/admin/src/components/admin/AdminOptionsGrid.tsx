import { cn, IconSquare } from '@tearleads/ui';
import { Database } from 'lucide-react';

const ADMIN_OPTIONS = [
  { id: 'redis', label: 'Redis' },
  { id: 'postgres', label: 'Postgres' },
  { id: 'groups', label: 'Groups' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'users', label: 'Users' },
  { id: 'compliance', label: 'Compliance' }
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
        'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
        gridClassName
      )}
    >
      {ADMIN_OPTIONS.map((option) => (
        <IconSquare
          key={option.id}
          icon={Database}
          label={option.label}
          onClick={() => onSelect(option.id)}
        />
      ))}
    </div>
  );
}
