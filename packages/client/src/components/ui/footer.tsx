import { cn } from '@/lib/utils';

function Footer({
  className,
  ref,
  children,
  ...props
}: React.ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="footer"
      ref={ref}
      className={cn(
        'fixed bottom-0 left-0 right-0 border-t bg-background py-6 text-center text-sm text-muted-foreground',
        className
      )}
      {...props}
    >
      <div className="container mx-auto px-4">
        {children ?? (
          <p>
            &copy; {new Date().getFullYear()} Tearleads. All rights reserved.
          </p>
        )}
      </div>
    </footer>
  );
}

export { Footer };
