import type { VfsPermissionLevel } from '@tearleads/shared';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib';
import { PERMISSION_COLORS, PERMISSION_OPTIONS } from './types';

interface SharePermissionSelectProps {
  value: VfsPermissionLevel;
  onChange: (value: VfsPermissionLevel) => void;
  disabled?: boolean;
}

export function SharePermissionSelect({
  value,
  onChange,
  disabled
}: SharePermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = PERMISSION_OPTIONS.find((opt) => opt.value === value);

  const handleSelect = useCallback(
    (level: VfsPermissionLevel) => {
      onChange(level);
      setOpen(false);
    },
    [onChange]
  );

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
          PERMISSION_COLORS[value],
          disabled ? 'cursor-default opacity-60' : 'cursor-pointer'
        )}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        data-testid="permission-select-trigger"
      >
        {selected && <selected.icon className="h-3 w-3" />}
        {selected?.label}
        {!disabled && <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 z-20 mt-1 w-56 rounded border bg-background shadow-lg"
          data-testid="permission-select-dropdown"
        >
          {PERMISSION_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => handleSelect(option.value)}
                data-testid={`permission-option-${option.value}`}
              >
                <option.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.description}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
