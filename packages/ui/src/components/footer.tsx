import { cn } from '../lib/utils.js';

export interface FooterProps extends React.ComponentProps<'footer'> {
  copyrightText?: string;
}

export function Footer({
  className,
  ref,
  children,
  copyrightText,
  ...props
}: FooterProps) {
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
            {copyrightText ??
              `\u00A9 ${new Date().getFullYear()} All rights reserved.`}
          </p>
        )}
      </div>
    </footer>
  );
}
