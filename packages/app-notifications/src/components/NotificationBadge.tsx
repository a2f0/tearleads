interface NotificationBadgeProps {
  count: number;
}

export function NotificationBadge({ count }: NotificationBadgeProps) {
  if (count === 0) return null;

  const displayCount = count > 99 ? '99+' : count.toString();

  return (
    <span
      className="absolute top-0 right-0 flex h-4 min-w-4 translate-x-1/2 -translate-y-[37.5%] items-center justify-center rounded-full bg-destructive px-1 font-medium text-[10px] text-destructive-foreground"
      title={`${count} unread notification${count !== 1 ? 's' : ''}`}
    >
      {displayCount}
    </span>
  );
}
