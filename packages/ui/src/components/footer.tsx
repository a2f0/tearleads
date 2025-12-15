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
        'fixed bottom-0 left-0 right-0 border-t bg-background py-6 text-sm text-muted-foreground',
        className
      )}
      {...props}
    >
      <div className="container mx-auto px-4 flex items-center">
        {version && (
          <span className="text-xs text-muted-foreground/70">{version}</span>
        )}
        <div className="flex-1 text-center">
          {children ?? (
            <p>
              {copyrightText ??
                `\u00A9 ${new Date().getFullYear()} All rights reserved.`}
            </p>
          )}
        </div>
        {version && <span className="text-xs invisible">{version}</span>}
      </div>
    </footer>
  );
}
