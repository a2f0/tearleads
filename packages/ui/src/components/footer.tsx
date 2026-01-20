import { cn } from '../lib/utils.js';

export interface FooterProps extends React.ComponentProps<'footer'> {
  copyrightText?: string;
  version: string | undefined;
  connectionIndicator?: React.ReactNode;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}

export function Footer({
  className,
  ref,
  children,
  copyrightText,
  version,
  connectionIndicator,
  leftAction,
  rightAction,
  ...props
}: FooterProps) {
  return (
    <footer
      data-slot="footer"
      ref={ref}
      className={cn(
        'fixed right-0 bottom-0 left-0 z-50 border-t bg-background py-4 text-muted-foreground text-sm',
        className
      )}
      style={{
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom, 0px))`
      }}
      {...props}
    >
      <div className="flex items-center px-4">
        <div className="flex min-w-64 items-center gap-2 pl-8">
          {leftAction}
        </div>
        <div className="flex items-center gap-2">
          {version && (
            <span className="text-muted-foreground/70 text-xs">{version}</span>
          )}
          {connectionIndicator}
        </div>
        <div className="flex-1 text-center">
          {children ?? (
            <p>
              {copyrightText ??
                `\u00A9 ${new Date().getFullYear()} All rights reserved.`}
            </p>
          )}
        </div>
        <div
          className={cn('flex items-center gap-2', !rightAction && 'invisible')}
        >
          {rightAction ?? (
            <>
              {version && <span className="text-xs">{version}</span>}
              {connectionIndicator && <span className="h-2 w-2" />}
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
