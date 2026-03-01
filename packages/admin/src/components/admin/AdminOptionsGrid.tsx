import { cn, IconSquare } from '@tearleads/ui';
import { Database } from 'lucide-react';
import type { AdminKeys } from '@admin/i18n/translations/types';
import { useTypedTranslation } from '@/i18n';

const ADMIN_OPTIONS = [
  { id: 'redis', labelKey: 'redis' },
  { id: 'postgres', labelKey: 'postgres' },
  { id: 'groups', labelKey: 'groups' },
  { id: 'organizations', labelKey: 'organizations' },
  { id: 'users', labelKey: 'users' },
  { id: 'compliance', labelKey: 'compliance' }
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: AdminKeys;
}>;

export type AdminOptionId = (typeof ADMIN_OPTIONS)[number]['id'];

interface AdminOptionsGridProps {
  onSelect: (id: AdminOptionId) => void;
  gridClassName?: string;
}

export function AdminOptionsGrid({
  onSelect,
  gridClassName
}: AdminOptionsGridProps) {
  const { t } = useTypedTranslation('admin');
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
          label={t(option.labelKey)}
          onClick={() => onSelect(option.id)}
        />
      ))}
    </div>
  );
}
