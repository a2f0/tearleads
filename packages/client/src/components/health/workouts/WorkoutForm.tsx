import type {
  CreateWorkoutEntryInput,
  Exercise,
  WeightUnit
} from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { selectClassName } from '../selectClassName';

interface WorkoutFormProps {
  exercises: Exercise[];
  onSubmit: (input: CreateWorkoutEntryInput) => Promise<void>;
}

interface FormErrors {
  exerciseId?: string;
  reps?: string;
  weight?: string;
  performedAt?: string;
}

function getLocalDateTimeString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, 16);
}

export function WorkoutForm({ exercises, onSubmit }: WorkoutFormProps) {
  const [categoryId, setCategoryId] = useState('');
  const [exerciseId, setExerciseId] = useState('');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const [performedAt, setPerformedAt] = useState(getLocalDateTimeString);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const parentExercises = useMemo(
    () => exercises.filter((e) => !e.parentId),
    [exercises]
  );

  const childExercises = useMemo(
    () => exercises.filter((e) => e.parentId === categoryId),
    [exercises, categoryId]
  );

  const handleCategoryChange = useCallback((newCategoryId: string) => {
    setCategoryId(newCategoryId);
    setExerciseId('');
  }, []);

  const getSelectedExerciseId = useCallback(() => {
    if (exerciseId) {
      return exerciseId;
    }
    if (categoryId && childExercises.length === 0) {
      return categoryId;
    }
    return '';
  }, [exerciseId, categoryId, childExercises.length]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextErrors: FormErrors = {};

      const selectedExerciseId = getSelectedExerciseId();
      if (!selectedExerciseId) {
        nextErrors.exerciseId = 'Exercise is required';
      }

      const trimmedReps = reps.trim();
      const parsedReps = Number.parseInt(trimmedReps, 10);
      if (trimmedReps.length === 0) {
        nextErrors.reps = 'Reps is required';
      } else if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
        nextErrors.reps = 'Reps must be a positive integer';
      }

      const trimmedWeight = weight.trim();
      const parsedWeight = Number.parseFloat(trimmedWeight);
      if (trimmedWeight.length === 0) {
        nextErrors.weight = 'Weight is required';
      } else if (Number.isNaN(parsedWeight) || parsedWeight < 0) {
        nextErrors.weight = 'Weight must be a non-negative number';
      }

      if (!performedAt) {
        nextErrors.performedAt = 'Date is required';
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
        const input: CreateWorkoutEntryInput = {
          exerciseId: selectedExerciseId,
          reps: parsedReps,
          weight: parsedWeight,
          weightUnit,
          performedAt: new Date(performedAt),
          ...(trimmedNote.length > 0 && { note: trimmedNote })
        };

        await onSubmit(input);

        setReps('');
        setWeight('');
        setNote('');
        setPerformedAt(getLocalDateTimeString());
      } catch (err) {
        console.error('Failed to add workout entry:', err);
        setSubmitError(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      getSelectedExerciseId,
      reps,
      weight,
      weightUnit,
      performedAt,
      note,
      onSubmit
    ]
  );

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={handleSubmit}
      aria-label="Add workout entry form"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <div className="space-y-1">
          <label
            htmlFor="workout-category"
            className="font-medium text-muted-foreground text-sm"
          >
            Category
          </label>
          <select
            id="workout-category"
            value={categoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className={selectClassName}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.exerciseId) && !categoryId}
          >
            <option value="">Select category</option>
            {parentExercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-exercise"
            className="font-medium text-muted-foreground text-sm"
          >
            Exercise
          </label>
          <select
            id="workout-exercise"
            value={exerciseId}
            onChange={(e) => setExerciseId(e.target.value)}
            className={selectClassName}
            disabled={
              isSubmitting || !categoryId || childExercises.length === 0
            }
            aria-invalid={Boolean(errors.exerciseId) && !!categoryId}
          >
            {childExercises.length === 0 ? (
              <option value="">
                {categoryId ? 'No variations' : 'Select category first'}
              </option>
            ) : (
              <>
                <option value="">Select variation</option>
                {childExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </>
            )}
          </select>
          {errors.exerciseId && (
            <p className="text-destructive text-sm">{errors.exerciseId}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-reps"
            className="font-medium text-muted-foreground text-sm"
          >
            Reps
          </label>
          <Input
            id="workout-reps"
            type="number"
            step="1"
            min="1"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="5"
            aria-invalid={Boolean(errors.reps)}
            disabled={isSubmitting}
          />
          {errors.reps && (
            <p className="text-destructive text-sm">{errors.reps}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-weight"
            className="font-medium text-muted-foreground text-sm"
          >
            Weight
          </label>
          <Input
            id="workout-weight"
            type="number"
            step="0.1"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="225"
            aria-invalid={Boolean(errors.weight)}
            disabled={isSubmitting}
          />
          {errors.weight && (
            <p className="text-destructive text-sm">{errors.weight}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-unit"
            className="font-medium text-muted-foreground text-sm"
          >
            Unit
          </label>
          <select
            id="workout-unit"
            value={weightUnit}
            onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
            className={selectClassName}
            disabled={isSubmitting}
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-date"
            className="font-medium text-muted-foreground text-sm"
          >
            Date & Time
          </label>
          <Input
            id="workout-date"
            type="datetime-local"
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
            aria-invalid={Boolean(errors.performedAt)}
            disabled={isSubmitting}
          />
          {errors.performedAt && (
            <p className="text-destructive text-sm">{errors.performedAt}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="workout-note"
            className="font-medium text-muted-foreground text-sm"
          >
            Note
          </label>
          <Input
            id="workout-note"
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
              'Add Entry'
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
