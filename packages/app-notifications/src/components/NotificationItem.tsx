import { cn } from '@tearleads/ui';
import { X } from 'lucide-react';
import type React from 'react';
import type {
  Notification,
  NotificationLevel
} from '../stores/notificationStore';

const LEVEL_BORDER_COLORS: Record<NotificationLevel, string> = {
  error: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-info',
  success: 'border-l-primary'
};

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  dismissLabel: string;
  relativeTime: string;
}

export function NotificationItem({
  notification,
  onDismiss,
  onMarkAsRead,
  onContextMenu,
  dismissLabel,
  relativeTime
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
            {relativeTime}
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
