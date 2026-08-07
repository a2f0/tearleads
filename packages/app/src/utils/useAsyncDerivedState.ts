import { useEffect, useState } from "react";

interface AsyncDerivedStateInput<TSource, TValue> {
  readonly createEmptyValue: () => TValue;
  readonly derive: (source: TSource) => Promise<TValue>;
  readonly errorMessage: string;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly source: TSource | null;
}

/**
 * Projects an asynchronous source into React state while ignoring results from
 * sources that were replaced or unmounted before the projection settled.
 */
export function useAsyncDerivedState<TSource, TValue>(
  input: AsyncDerivedStateInput<TSource, TValue>,
): TValue {
  const [value, setValue] = useState(input.createEmptyValue);

  useEffect(() => {
    if (input.source === null) {
      setValue(input.createEmptyValue());
      return;
    }

    let cancelled = false;
    void input
      .derive(input.source)
      .then((nextValue) => {
        if (!cancelled) {
          setValue(nextValue);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setValue(input.createEmptyValue());
          input.logError(input.errorMessage, error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    input.createEmptyValue,
    input.derive,
    input.errorMessage,
    input.logError,
    input.source,
  ]);

  return value;
}
