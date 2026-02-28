import { cn } from '@tearleads/window-manager';
import type { ReactNode } from 'react';

interface MenuDropdownProps {
  isOpen: boolean;
  label: string;
  minWidthClassName: string;
  onToggle: () => void;
  children: ReactNode;
}

export function MenuDropdown({
  isOpen,
  label,
  minWidthClassName,
  onToggle,
  children
}: MenuDropdownProps) {
  return (
    <div className="relative">
      <button
        type="button"
        className="rounded px-2 py-1 text-sm hover:bg-accent"
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen ? (
        <div
          role="menu"
          className={cn(
            'absolute left-0 z-50 mt-1 rounded border bg-popover p-1 shadow-md',
            minWidthClassName
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
