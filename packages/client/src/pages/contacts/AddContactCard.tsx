import { Plus, User } from 'lucide-react';

interface AddContactCardProps {
  onClick: () => void;
  size?: 'large' | 'small';
}

export function AddContactCard({
  onClick,
  size = 'large'
}: AddContactCardProps) {
  const isLarge = size === 'large';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-4 rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${isLarge ? 'p-8' : 'p-4'}`}
      data-testid="add-contact-card"
    >
      <User className={isLarge ? 'h-8 w-8' : 'h-5 w-5'} />
      <span className={`font-medium ${isLarge ? '' : 'text-sm'}`}>
        Add new contact
      </span>
      <Plus className={isLarge ? 'h-6 w-6' : 'h-4 w-4'} />
    </button>
  );
}
