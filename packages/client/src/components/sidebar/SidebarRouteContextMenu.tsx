import { AppWindow, ExternalLink } from 'lucide-react';
import { ContextMenu } from '@/components/ui/context-menu/ContextMenu';
import { ContextMenuItem } from '@/components/ui/context-menu/ContextMenuItem';
import type { SidebarContextMenuState } from './types';

interface SidebarRouteContextMenuProps {
  contextMenu: SidebarContextMenuState | null;
  onClose: () => void;
  onOpenRoute: () => void;
  onOpenInWindow: () => void;
  canOpenInWindow: (path: string) => boolean;
}

export function SidebarRouteContextMenu({
  contextMenu,
  onClose,
  onOpenRoute,
  onOpenInWindow,
  canOpenInWindow
}: SidebarRouteContextMenuProps) {
  if (!contextMenu) {
    return null;
  }

  return (
    <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={onClose}>
      <ContextMenuItem
        icon={<ExternalLink className="h-4 w-4" />}
        onClick={onOpenRoute}
      >
        Open
      </ContextMenuItem>
      {canOpenInWindow(contextMenu.path) && (
        <ContextMenuItem
          icon={<AppWindow className="h-4 w-4" />}
          onClick={onOpenInWindow}
        >
          Open in Window
        </ContextMenuItem>
      )}
    </ContextMenu>
  );
}
