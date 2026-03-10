import { Menu } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { WindowControlButton } from '../WindowControlButton.js';

export interface WindowSidebarToggleProps {
  onToggle: () => void;
}

export function WindowSidebarToggle({ onToggle }: WindowSidebarToggleProps) {
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <WindowControlButton
      icon={<Menu className="h-3 w-3" />}
      onClick={onToggle}
      aria-label="Toggle sidebar"
      data-testid="window-sidebar-toggle"
    />
  );
}
