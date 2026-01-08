import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CacheDeleteButtonProps {
  onClick: () => void;
  title?: string;
}

export function CacheDeleteButton({
  onClick,
  title = 'Delete'
}: CacheDeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}
