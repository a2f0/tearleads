interface ContextMenuItemProps {
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}

export function ContextMenuItem({
  icon,
  onClick,
  children
}: ContextMenuItemProps) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
