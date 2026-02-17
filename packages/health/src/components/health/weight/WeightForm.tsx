import type { CreateWeightReadingInput, WeightUnit } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

interface WeightFormProps {
  onSubmit: (input: CreateWeightReadingInput) => Promise<void>;
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

export function WeightForm({ onSubmit }: WeightFormProps) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('lb');
  const [recordedAt, setRecordedAt] = useState(getLocalDateTimeString);
  const [note, setNote] = useState('');
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
        nextErrors.value = 'Weight is required';
      } else if (Number.isNaN(parsedValue) || parsedValue <= 0) {
        nextErrors.value = 'Weight must be a positive number';
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
        const input: CreateWeightReadingInput = {
          value: parsedValue,
          unit,
          recordedAt: new Date(recordedAt),
          ...(trimmedNote.length > 0 && { note: trimmedNote })
        };

        await onSubmit(input);

        setValue('');
        setNote('');
        setRecordedAt(getLocalDateTimeString());
      } catch (err) {
        console.error('Failed to add weight reading:', err);
        setSubmitError(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setIsSubmitting(false);
      }
    },
    [value, unit, recordedAt, note, onSubmit]
  );

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={handleSubmit}
      aria-label="Add weight reading form"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label
            htmlFor="weight-value"
            className="font-medium text-muted-foreground text-sm"
          >
            Weight
          </label>
          <Input
            id="weight-value"
            type="number"
            step="0.1"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="185.5"
            aria-invalid={Boolean(errors.value)}
            disabled={isSubmitting}
          />
          {errors.value && (
            <p className="text-destructive text-sm">{errors.value}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="weight-unit"
            className="font-medium text-muted-foreground text-sm"
          >
            Unit
          </label>
          <select
            id="weight-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as WeightUnit)}
            className="w-full rounded-md border bg-background px-3 py-2 text-base"
            disabled={isSubmitting}
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="weight-date"
            className="font-medium text-muted-foreground text-sm"
          >
            Date & Time
          </label>
          <Input
            id="weight-date"
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            aria-invalid={Boolean(errors.recordedAt)}
            disabled={isSubmitting}
          />
          {errors.recordedAt && (
            <p className="text-destructive text-sm">{errors.recordedAt}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="weight-note"
            className="font-medium text-muted-foreground text-sm"
          >
            Note
          </label>
          <Input
            id="weight-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            disabled={isSubmitting}
          />
        </div>
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
