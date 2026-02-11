import { Dialog } from '@tearleads/ui';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface NewCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

export function NewCalendarDialog({
  open,
  onOpenChange,
  onCreate
}: NewCalendarDialogProps) {
  const [calendarName, setCalendarName] = useState('');

  useEffect(() => {
    if (open) {
      setCalendarName('');
    }
  }, [open]);

  const handleCreate = () => {
    const trimmed = calendarName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Calendar"
      data-testid="new-calendar-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <Input
          type="text"
          value={calendarName}
          onChange={(event) => setCalendarName(event.target.value)}
          placeholder="Calendar name"
          autoComplete="off"
          data-testid="new-calendar-name-input"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="new-calendar-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!calendarName.trim()}
            data-testid="new-calendar-create"
          >
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
