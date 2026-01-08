import type { VariantProps } from 'class-variance-authority';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, type buttonVariants } from './button';

interface RefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
}

export function RefreshButton({
  onClick,
  loading = false,
  disabled = false,
  ariaLabel = 'Refresh',
  className,
  variant = 'outline',
  size = 'icon'
}: RefreshButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
    >
      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
    </Button>
  );
}
