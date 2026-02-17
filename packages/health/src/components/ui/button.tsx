import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive';
}

export function Button({
  className,
  variant = 'default',
  ...props
}: ButtonProps) {
  const variantClasses =
    variant === 'outline'
      ? 'border bg-background hover:bg-accent'
      : variant === 'destructive'
        ? 'bg-destructive text-destructive-foreground hover:opacity-90'
        : 'bg-primary text-primary-foreground hover:opacity-90';

  return (
    <button
      className={`inline-flex h-9 items-center justify-center rounded-md px-4 py-2 font-medium text-sm transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClasses} ${className ?? ''}`}
      {...props}
    />
  );
}
