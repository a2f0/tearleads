import type { CreateBloodPressureReadingInput } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface BloodPressureFormProps {
  onSubmit: (input: CreateBloodPressureReadingInput) => Promise<void>;
}

interface FormErrors {
  systolic?: string;
  diastolic?: string;
  pulse?: string;
  recordedAt?: string;
}

function getLocalDateTimeString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, 16);
}

export function BloodPressureForm({ onSubmit }: BloodPressureFormProps) {
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [recordedAt, setRecordedAt] = useState(getLocalDateTimeString);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextErrors: FormErrors = {};

      const trimmedSystolic = systolic.trim();
      const parsedSystolic = Number.parseInt(trimmedSystolic, 10);
      if (trimmedSystolic.length === 0) {
        nextErrors.systolic = 'Systolic is required';
      } else if (!Number.isInteger(parsedSystolic) || parsedSystolic <= 0) {
        nextErrors.systolic = 'Systolic must be a positive integer';
      }

      const trimmedDiastolic = diastolic.trim();
      const parsedDiastolic = Number.parseInt(trimmedDiastolic, 10);
      if (trimmedDiastolic.length === 0) {
        nextErrors.diastolic = 'Diastolic is required';
      } else if (!Number.isInteger(parsedDiastolic) || parsedDiastolic <= 0) {
        nextErrors.diastolic = 'Diastolic must be a positive integer';
      }

      if (
        !nextErrors.systolic &&
        !nextErrors.diastolic &&
        parsedSystolic <= parsedDiastolic
      ) {
        nextErrors.systolic = 'Systolic must be greater than diastolic';
      }

      const trimmedPulse = pulse.trim();
      let parsedPulse: number | undefined;
      if (trimmedPulse.length > 0) {
        parsedPulse = Number.parseInt(trimmedPulse, 10);
        if (!Number.isInteger(parsedPulse) || parsedPulse <= 0) {
          nextErrors.pulse = 'Pulse must be a positive integer';
        }
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
        const input: CreateBloodPressureReadingInput = {
          systolic: parsedSystolic,
          diastolic: parsedDiastolic,
          recordedAt: new Date(recordedAt),
          ...(parsedPulse !== undefined && { pulse: parsedPulse }),
          ...(trimmedNote.length > 0 && { note: trimmedNote })
        };

        await onSubmit(input);

        setSystolic('');
        setDiastolic('');
        setPulse('');
        setNote('');
        setRecordedAt(getLocalDateTimeString());
      } catch (err) {
        console.error('Failed to add blood pressure reading:', err);
        setSubmitError(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setIsSubmitting(false);
      }
    },
    [systolic, diastolic, pulse, recordedAt, note, onSubmit]
  );

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={handleSubmit}
      aria-label="Add blood pressure reading form"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <div className="space-y-1">
          <label
            htmlFor="bp-systolic"
            className="font-medium text-muted-foreground text-sm"
          >
            Systolic
          </label>
          <Input
            id="bp-systolic"
            type="number"
            step="1"
            min="1"
            value={systolic}
            onChange={(e) => setSystolic(e.target.value)}
            placeholder="120"
            aria-invalid={Boolean(errors.systolic)}
            disabled={isSubmitting}
          />
          {errors.systolic && (
            <p className="text-destructive text-sm">{errors.systolic}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="bp-diastolic"
            className="font-medium text-muted-foreground text-sm"
          >
            Diastolic
          </label>
          <Input
            id="bp-diastolic"
            type="number"
            step="1"
            min="1"
            value={diastolic}
            onChange={(e) => setDiastolic(e.target.value)}
            placeholder="80"
            aria-invalid={Boolean(errors.diastolic)}
            disabled={isSubmitting}
          />
          {errors.diastolic && (
            <p className="text-destructive text-sm">{errors.diastolic}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="bp-pulse"
            className="font-medium text-muted-foreground text-sm"
          >
            Pulse (optional)
          </label>
          <Input
            id="bp-pulse"
            type="number"
            step="1"
            min="1"
            value={pulse}
            onChange={(e) => setPulse(e.target.value)}
            placeholder="72"
            aria-invalid={Boolean(errors.pulse)}
            disabled={isSubmitting}
          />
          {errors.pulse && (
            <p className="text-destructive text-sm">{errors.pulse}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="bp-date"
            className="font-medium text-muted-foreground text-sm"
          >
            Date & Time
          </label>
          <Input
            id="bp-date"
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
            htmlFor="bp-note"
            className="font-medium text-muted-foreground text-sm"
          >
            Note
          </label>
          <Input
            id="bp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
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
