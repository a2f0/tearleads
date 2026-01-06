import { RefreshCw } from 'lucide-react';
import { Button } from './button';

interface RefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function RefreshButton({
  onClick,
  loading = false,
  disabled = false
}: RefreshButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label="Refresh"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
    </Button>
  );
}
