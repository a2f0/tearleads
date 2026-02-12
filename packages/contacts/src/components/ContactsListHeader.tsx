import { User } from 'lucide-react';

interface ContactsListHeaderProps {
  isUnlocked: boolean;
  children?: React.ReactNode;
}

export function ContactsListHeader({
  isUnlocked,
  children
}: ContactsListHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <User className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Contacts</h2>
      </div>
      {isUnlocked ? children : null}
    </div>
  );
}
