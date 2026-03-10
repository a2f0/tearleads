import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isDefaultExercise } from '../../../lib/defaultExercises.js';

/**
 * Hook to get translated exercise names.
 * Default exercises are translated using i18n.
 * User-created exercises fall back to the stored name.
 */
export function useExerciseTranslation() {
  const { t } = useTranslation('health');

  const getExerciseName = useCallback(
    (exerciseId: string, fallbackName: string): string => {
      if (isDefaultExercise(exerciseId)) {
        return t(`exerciseNames.${exerciseId}`, { defaultValue: fallbackName });
      }
      return fallbackName;
    },
    [t]
  );

  return { getExerciseName };
}
