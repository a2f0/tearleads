import { Button } from '../button.js';
import { Dialog } from '../dialog.js';

export interface WindowOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preserveWindowState: boolean;
  onSave: (preserveWindowState: boolean) => void;
}

export function WindowOptionsDialog({
  open,
  onOpenChange,
  preserveWindowState,
  onSave
}: WindowOptionsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Window Options"
      data-testid="window-options-dialog"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="windowState"
              checked={preserveWindowState}
              onChange={() => onSave(true)}
              className="h-4 w-4"
              data-testid="window-state-preserve-radio"
            />
            <span>Preserve window state</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="windowState"
              checked={!preserveWindowState}
              onChange={() => onSave(false)}
              className="h-4 w-4"
              data-testid="window-state-default-radio"
            />
            <span>Use default window state</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="window-options-cancel"
          >
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)} data-testid="window-options-ok">
            OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
