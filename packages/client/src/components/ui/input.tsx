import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const inputVariants = cva(
  'flex w-full rounded-md border bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-9',
        sm: 'h-8 px-2',
        lg: 'h-11 px-4'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
);

function Input({
  className,
  size,
  type,
  ref,
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(inputVariants({ size, className }))}
      ref={ref}
      {...props}
    />
  );
}

export { Input, inputVariants };
