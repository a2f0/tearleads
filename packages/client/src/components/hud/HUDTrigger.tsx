import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { notificationStore } from '@/stores/notificationStore';
import { HUD } from './HUD';
import { NotificationBadge } from './NotificationBadge';

export function HUDTrigger() {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setUnreadCount(notificationStore.getUnreadCount());

    const unsubscribe = notificationStore.subscribe(() => {
      setUnreadCount(notificationStore.getUnreadCount());
    });

    return unsubscribe;
  }, []);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Open HUD"
          title="Head's Up Display"
        >
          <Activity className="h-4 w-4 translate-y-0.5" />
        </button>
        <NotificationBadge count={unreadCount} />
      </div>
      <HUD isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
