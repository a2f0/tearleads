import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StorageDeleteButtonProps {
  onClick: () => void;
}

export function StorageDeleteButton({ onClick }: StorageDeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100"
      onClick={onClick}
      title="Delete"
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}
