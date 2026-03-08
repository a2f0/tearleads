import { IconSquare } from '@tearleads/ui';
import { Globe, Monitor } from 'lucide-react';

const DEBUG_OPTIONS = [
  { id: 'system-info', label: 'System Info', icon: Monitor },
  { id: 'browser', label: 'Browser', icon: Globe }
] as const;

export type DebugOptionId = (typeof DEBUG_OPTIONS)[number]['id'];

interface DebugOptionsGridProps {
  onSelect: (id: DebugOptionId) => void;
}

export function DebugOptionsGrid({ onSelect }: DebugOptionsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
      {DEBUG_OPTIONS.map((option) => (
        <IconSquare
          key={option.id}
          icon={option.icon}
          label={option.label}
          onClick={() => onSelect(option.id)}
          data-testid={`debug-option-${option.id}`}
        />
      ))}
    </div>
  );
}
