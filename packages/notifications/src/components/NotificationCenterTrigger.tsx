import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { useWindowManager } from '@tearleads/window-manager';
import { Activity, Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationStore } from '../stores/notificationStore';
import { NotificationBadge } from './NotificationBadge';

export function NotificationCenterTrigger() {
  const { openWindow } = useWindowManager();
  const { t: tCommon } = useTranslation('common');
  const { t: tMenu } = useTranslation('menu');
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
      <button
        type="button"
        onClick={handleOpen}
        onContextMenu={handleContextMenu}
        className="relative rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={tMenu('openNotificationCenter')}
        title={tMenu('notificationCenter')}
        data-testid="notification-center-trigger"
      >
        <Activity className="h-4 w-4" />
        <NotificationBadge count={unreadCount} />
      </button>
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
            {tCommon('markAllAsRead')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleClearAll}
          >
            {tCommon('dismissAll')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Bell className="h-4 w-4" />}
            onClick={handleOpen}
          >
            {tMenu('openNotificationCenter')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
