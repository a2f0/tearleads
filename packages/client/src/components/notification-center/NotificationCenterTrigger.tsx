import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { Activity, Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { notificationStore } from '@/stores/notificationStore';
import { NotificationBadge } from './NotificationBadge';

export function NotificationCenterTrigger() {
  const { openWindow } = useWindowManager();
  const [unreadCount, setUnreadCount] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setUnreadCount(notificationStore.getUnreadCount());

    const unsubscribe = notificationStore.subscribe(() => {
      setUnreadCount(notificationStore.getUnreadCount());
    });

    return unsubscribe;
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleMarkAllAsRead = useCallback(() => {
    notificationStore.markAllAsRead();
    setContextMenu(null);
  }, []);

  const handleClearAll = useCallback(() => {
    notificationStore.dismissAll();
    setContextMenu(null);
  }, []);

  const handleOpen = useCallback(() => {
    openWindow('notification-center');
    setContextMenu(null);
  }, [openWindow]);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={handleOpen}
          onContextMenu={handleContextMenu}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Open Notification Center"
          title="Notification Center"
        >
          <Activity className="h-4 w-4 translate-y-0.5" />
        </button>
        <NotificationBadge count={unreadCount} />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<CheckCheck className="h-4 w-4" />}
            onClick={handleMarkAllAsRead}
          >
            Mark all as read
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleClearAll}
          >
            Clear all notifications
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Bell className="h-4 w-4" />}
            onClick={handleOpen}
          >
            Open Notification Center
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
