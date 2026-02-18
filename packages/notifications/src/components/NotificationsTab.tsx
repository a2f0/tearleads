import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { cn } from '@tearleads/ui';
import { CheckCheck, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Notification,
  type NotificationLevel,
  notificationStore
} from '../stores/notificationStore';

const LEVEL_BORDER_COLORS: Record<NotificationLevel, string> = {
  error: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-info',
  success: 'border-l-primary'
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  dismissLabel: string;
}

function NotificationItem({
  notification,
  onDismiss,
  onMarkAsRead,
  onContextMenu,
  dismissLabel
}: NotificationItemProps) {
  const handleClick = () => {
    if (!notification.read) {
      onMarkAsRead(notification.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(notification.id, e.clientX, e.clientY);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Click handler marks as read, keyboard users can use dismiss button
    // biome-ignore lint/a11y/noStaticElementInteractions: Click handler marks as read, keyboard users can use dismiss button
    <div
      className={cn(
        'w-full cursor-pointer rounded border border-l-4 bg-muted/30 px-2 py-1.5 text-left [border-color:var(--soft-border)]',
        LEVEL_BORDER_COLORS[notification.level],
        !notification.read && 'bg-muted/50'
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-xs">{notification.title}</span>
            {!notification.read && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                data-testid="unread-indicator"
              />
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {notification.message}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(notification.timestamp)}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={dismissLabel}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function NotificationsTab() {
  const { t } = useTranslation('common');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setNotifications(notificationStore.getNotifications());

    const unsubscribe = notificationStore.subscribe(() => {
      setNotifications(notificationStore.getNotifications());
    });

    return unsubscribe;
  }, []);

  const handleDismiss = (id: string) => {
    notificationStore.dismiss(id);
  };

  const handleMarkAsRead = (id: string) => {
    notificationStore.markAsRead(id);
  };

  const handleMarkAllAsRead = () => {
    notificationStore.markAllAsRead();
  };

  const handleDismissAll = () => {
    notificationStore.dismissAll();
  };

  const handleContextMenu = useCallback((id: string, x: number, y: number) => {
    setContextMenu({ id, x, y });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const contextMenuNotification = useMemo(
    () =>
      contextMenu ? notifications.find((n) => n.id === contextMenu.id) : null,
    [contextMenu, notifications]
  );

  const handleContextMenuMarkAsRead = useCallback(() => {
    if (contextMenuNotification) {
      notificationStore.markAsRead(contextMenuNotification.id);
      setContextMenu(null);
    }
  }, [contextMenuNotification]);

  const handleContextMenuDismiss = useCallback(() => {
    if (contextMenuNotification) {
      notificationStore.dismiss(contextMenuNotification.id);
      setContextMenu(null);
    }
  }, [contextMenuNotification]);

  if (notifications.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        {t('noNotifications')}
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  const notificationCountText =
    notifications.length === 1
      ? t('notificationCount', { count: notifications.length })
      : t('notificationCountPlural', { count: notifications.length });

  const unreadText =
    unreadCount > 0 ? ` (${t('unread', { count: unreadCount })})` : '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          {notificationCountText}
          {unreadText}
        </span>
        <div className="flex gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('markAllAsRead')}
              title={t('markAllAsRead')}
            >
              <CheckCheck className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDismissAll}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('dismissAll')}
            title={t('dismissAll')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={handleDismiss}
            onMarkAsRead={handleMarkAsRead}
            onContextMenu={handleContextMenu}
            dismissLabel={t('dismissNotification')}
          />
        ))}
      </div>
      {contextMenuNotification && contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {!contextMenuNotification.read && (
            <ContextMenuItem
              icon={<CheckCheck className="h-4 w-4" />}
              onClick={handleContextMenuMarkAsRead}
            >
              Mark as read
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleContextMenuDismiss}
          >
            Dismiss
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
