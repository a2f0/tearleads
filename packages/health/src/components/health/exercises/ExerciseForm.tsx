import type { CreateExerciseInput, Exercise } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { selectClassName } from '../selectClassName';
import { useExerciseTranslation } from './useExerciseTranslation';

interface ExerciseFormProps {
  parentExercises: Exercise[];
  onSubmit: (input: CreateExerciseInput) => Promise<void>;
}

interface FormErrors {
  name?: string;
}

export function ExerciseForm({ parentExercises, onSubmit }: ExerciseFormProps) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { t } = useTranslation('health');
  const { getExerciseName } = useExerciseTranslation();

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextErrors: FormErrors = {};

      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        nextErrors.name = 'Name is required';
      }

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const input: CreateExerciseInput = {
          name: trimmedName,
          ...(parentId && { parentId })
        };

        await onSubmit(input);

        setName('');
        setParentId('');
      } catch (err) {
        console.error('Failed to add exercise:', err);
        setSubmitError(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setIsSubmitting(false);
      }
    },
    [name, parentId, onSubmit]
  );

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={handleSubmit}
      aria-label="Add exercise form"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <label
            htmlFor="exercise-name"
            className="font-medium text-muted-foreground text-sm"
          >
            {t('exerciseName')}
          </label>
          <Input
            id="exercise-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Front Squat"
            aria-invalid={Boolean(errors.name)}
            disabled={isSubmitting}
          />
          {errors.name && (
            <p className="text-destructive text-sm">{errors.name}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="exercise-parent"
            className="font-medium text-muted-foreground text-sm"
          >
            {t('category')}
          </label>
          <select
            id="exercise-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className={selectClassName}
            disabled={isSubmitting}
          >
            <option value="">None (Top-level exercise)</option>
            {parentExercises.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {getExerciseName(parent.id, parent.name)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              t('addExercise')
            )}
          </Button>
        </div>
      </div>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}
    </form>
  );
}
