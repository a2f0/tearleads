import { cn } from '../lib/utils.js';

export interface FooterProps extends React.ComponentProps<'footer'> {
  copyrightText?: string;
  version: string | undefined;
}

export function Footer({
  className,
  ref,
  children,
  copyrightText,
  version,
  ...props
}: FooterProps) {
  return (
    <footer
      data-slot="footer"
      ref={ref}
      className={cn(
        'fixed right-0 bottom-0 left-0 border-t bg-background py-6 text-muted-foreground text-sm',
        className
      )}
      style={{
        paddingBottom: `calc(1.5rem + env(safe-area-inset-bottom, 0px))`
      }}
      {...props}
    >
      <div className="container mx-auto flex items-center px-4">
        {version && (
          <span className="text-muted-foreground/70 text-xs">{version}</span>
        )}
        <div className="flex-1 text-center">
          {children ?? (
            <p>
              {copyrightText ??
                `\u00A9 ${new Date().getFullYear()} All rights reserved.`}
            </p>
          )}
        </div>
        {version && <span className="invisible text-xs">{version}</span>}
      </div>
    </footer>
  );
}
