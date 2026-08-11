import { type Context, createContext, useContext } from "react";

export interface RequiredContext<T> {
  /** The raw context, for rendering `context.Provider` in the owning provider. */
  context: Context<T | null>;
  /** Non-throwing twin for surfaces that may render outside the provider. */
  useOptional: () => T | null;
  /** Reads the context value, throwing `errorMessage` without a provider. */
  useRequired: () => T;
}

/**
 * A context whose value is mandatory for consumers. Callers export
 * `useRequired`/`useOptional` under their own hook names, so every
 * provider-guard hook shares this one accessor pair instead of restating the
 * `useContext`-then-throw boilerplate.
 */
export function createRequiredContext<T>(
  errorMessage: string,
): RequiredContext<T> {
  const context = createContext<T | null>(null);

  function useOptional(): T | null {
    return useContext(context);
  }

  function useRequired(): T {
    const value = useContext(context);
    if (value === null) {
      throw new Error(errorMessage);
    }
    return value;
  }

  return { context, useOptional, useRequired };
}
