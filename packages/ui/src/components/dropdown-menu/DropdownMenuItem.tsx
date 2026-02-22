import { Check } from 'lucide-react';
import { forwardRef } from 'react';

interface DropdownMenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  checked?: boolean;
  disabled?: boolean;
  preventClose?: boolean;
}

export const DropdownMenuItem = forwardRef<
  HTMLButtonElement,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  {
    children,
    onClick,
    icon,
    checked,
    disabled = false,
    preventClose: _preventClose
  },
  ref
) {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled && onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="w-3 shrink-0">
        {checked !== undefined && checked && (
          <Check className="h-3 w-3" aria-hidden="true" />
        )}
      </span>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  );
});
