import { cn } from '@/lib/utils';

export function CardFooter({
  className,
  ref,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      ref={ref}
      className={cn('flex items-center p-6 pt-0', className)}
      {...props}
    />
  );
}
