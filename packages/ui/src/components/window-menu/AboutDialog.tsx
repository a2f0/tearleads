import { Button } from '../button.js';
import { Dialog } from '../dialog.js';

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  appName?: string | undefined;
  closeLabel?: string | undefined;
}

export function AboutDialog({
  open,
  onOpenChange,
  version,
  appName = 'App',
  closeLabel = 'Close'
}: AboutDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`About ${appName}`}
      data-testid="about-dialog"
    >
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Version: <span data-testid="about-version">{version}</span>
        </p>
        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)} data-testid="about-ok">
            {closeLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
