import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type {
  CreateHeightReadingInput,
  HeightUnit
} from '../../../lib/healthTrackerTypes.js';
import type { AvailableContact } from '../../../runtime/HealthRuntimeContext';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { ContactPickerSelect } from '../ContactPickerSelect';

interface HeightFormProps {
  onSubmit: (input: CreateHeightReadingInput) => Promise<void>;
  availableContacts: AvailableContact[];
}

interface FormErrors {
  value?: string;
  recordedAt?: string;
}

function getLocalDateTimeString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, 16);
}

function getHeightUnit(value: string): HeightUnit {
  return value === 'cm' ? 'cm' : 'in';
}

export function HeightForm({ onSubmit, availableContacts }: HeightFormProps) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<HeightUnit>('in');
  const [recordedAt, setRecordedAt] = useState(getLocalDateTimeString);
  const [note, setNote] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextErrors: FormErrors = {};
      const trimmedValue = value.trim();
      const parsedValue = Number.parseFloat(trimmedValue);

      if (trimmedValue.length === 0) {
        nextErrors.value = 'Height is required';
      } else if (Number.isNaN(parsedValue) || parsedValue <= 0) {
        nextErrors.value = 'Height must be a positive number';
      }

      if (!recordedAt) {
        nextErrors.recordedAt = 'Date is required';
      }

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const trimmedNote = note.trim();
        const input: CreateHeightReadingInput = {
          value: parsedValue,
          unit,
          recordedAt: new Date(recordedAt),
          contactId,
          ...(trimmedNote.length > 0 && { note: trimmedNote })
        };

        await onSubmit(input);

        setValue('');
        setNote('');
        setRecordedAt(getLocalDateTimeString());
      } catch (err) {
        console.error('Failed to add height reading:', err);
        setSubmitError(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setIsSubmitting(false);
      }
    },
    [value, unit, recordedAt, note, contactId, onSubmit]
  );

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={handleSubmit}
      aria-label="Add height reading form"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="space-y-1">
          <label
            htmlFor="height-value"
            className="font-medium text-muted-foreground text-sm"
          >
            Height
          </label>
          <Input
            id="height-value"
            type="number"
            step="0.1"
            min="0"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="43.5"
            aria-invalid={Boolean(errors.value)}
            disabled={isSubmitting}
          />
          {errors.value && (
            <p className="text-destructive text-sm">{errors.value}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="height-unit"
            className="font-medium text-muted-foreground text-sm"
          >
            Unit
          </label>
          <select
            id="height-unit"
            value={unit}
            onChange={(event) => setUnit(getHeightUnit(event.target.value))}
            className="w-full rounded-md border bg-background px-3 py-2 text-base"
            disabled={isSubmitting}
          >
            <option value="in">in</option>
            <option value="cm">cm</option>
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="height-date"
            className="font-medium text-muted-foreground text-sm"
          >
            Date & Time
          </label>
          <Input
            id="height-date"
            type="datetime-local"
            value={recordedAt}
            onChange={(event) => setRecordedAt(event.target.value)}
            aria-invalid={Boolean(errors.recordedAt)}
            disabled={isSubmitting}
          />
          {errors.recordedAt && (
            <p className="text-destructive text-sm">{errors.recordedAt}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="height-note"
            className="font-medium text-muted-foreground text-sm"
          >
            Note
          </label>
          <Input
            id="height-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
            disabled={isSubmitting}
          />
        </div>

        <ContactPickerSelect
          contacts={availableContacts}
          value={contactId}
          onChange={setContactId}
          disabled={isSubmitting}
        />
      </div>

      <div className="flex items-center justify-between">
        {submitError && (
          <p className="text-destructive text-sm">{submitError}</p>
        )}
        <div className="ml-auto">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Reading'
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
