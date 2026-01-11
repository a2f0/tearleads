import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ children, className }: SettingsSectionProps) {
  return (
    <div className={cn('rounded-lg border p-4', className)}>{children}</div>
  );
}
