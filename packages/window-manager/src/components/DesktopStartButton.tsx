import { forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export interface DesktopStartButtonProps {
  /** Logo/icon source URL */
  logoSrc: string;
  /** Alt text for the logo */
  logoAlt?: string;
  /** Whether the sidebar is currently open */
  isOpen: boolean;
  /** Called when the button is clicked */
  onClick: () => void;
  /** Called on right-click */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Optional additional className */
  className?: string;
}

export const DesktopStartButton = forwardRef<
  HTMLButtonElement,
  DesktopStartButtonProps
>(function DesktopStartButton(
  { logoSrc, logoAlt = '', isOpen, onClick, onContextMenu, className },
  ref
) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      ref={ref}
      className={cn('hidden items-center justify-center lg:flex', className)}
      aria-label="Toggle sidebar"
      aria-pressed={isOpen}
      aria-controls="sidebar"
      data-testid="start-button"
    >
      <img src={logoSrc} alt={logoAlt} className="h-6 w-6" aria-hidden="true" />
    </button>
  );
});
