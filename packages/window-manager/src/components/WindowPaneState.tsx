import { cn } from '@tearleads/ui';

type WindowPaneStateTone = 'default' | 'error';
type WindowPaneStateLayout = 'inline' | 'stack';

export interface WindowPaneStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: WindowPaneStateTone | undefined;
  layout?: WindowPaneStateLayout | undefined;
  className?: string | undefined;
}

const TONE_CLASSNAMES: Record<WindowPaneStateTone, string> = {
  default: 'text-muted-foreground',
  error: 'border-destructive bg-destructive/10 text-destructive'
};

const LAYOUT_CLASSNAMES: Record<WindowPaneStateLayout, string> = {
  inline: 'flex items-center justify-center gap-2 p-4 text-xs',
  stack: 'flex flex-col items-center justify-center gap-2 p-6 text-center'
};

export function WindowPaneState({
  icon,
  title,
  description,
  action,
  tone = 'default',
  layout = 'stack',
  className
}: WindowPaneStateProps) {
  return (
    <div
      className={cn(
        'rounded-lg border [border-color:var(--soft-border)]',
        TONE_CLASSNAMES[tone],
        LAYOUT_CLASSNAMES[layout],
        className
      )}
    >
      {icon}
      <div>
        <p className="font-medium text-sm">{title}</p>
        {description && (
          <p className="whitespace-pre-line text-muted-foreground text-xs">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
