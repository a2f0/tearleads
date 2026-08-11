import { useEffect, useRef, useState } from "react";

interface ScopedOrganizationLoadInput<Value> {
  enabled: boolean;
  /** Loads the value; must resolve (map failures to an error-shaped Value). */
  load: () => Promise<Value>;
  /**
   * Value to show while a load is in flight; receives the previous value when
   * it was produced for the same organization. Omit to keep the prior state.
   */
  onBegin?: (previousValue: Value | null) => Value;
  organizationId: string;
  /** Re-runs the load when it changes. */
  reloadToken?: unknown;
  /**
   * Identity of what `load` reads (the SDK runtime). Re-runs the load when it
   * is replaced, so a new runtime never serves state fetched by the old one.
   */
  source: unknown;
  /** Value recorded while disabled; omit to keep the prior state. */
  whenDisabled?: Value;
}

/**
 * Shared skeleton for the billing panel's per-organization fetches: runs
 * `load` whenever the organization, enabled state, or reload token change,
 * drops stale responses, and only reports a value that was produced for the
 * organization on screen (returning null otherwise) so nothing leaks across
 * an org switch.
 */
export function useScopedOrganizationLoad<Value>(
  input: ScopedOrganizationLoadInput<Value>,
): Value | null {
  const { enabled, organizationId, reloadToken, source } = input;
  const inputRef = useRef(input);
  inputRef.current = input;
  const requestIdRef = useRef(0);
  const [state, setState] = useState<{
    organizationId: string;
    value: Value;
  } | null>(null);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const { load, onBegin, whenDisabled } = inputRef.current;
    if (!enabled) {
      if (whenDisabled !== undefined) {
        setState({ organizationId, value: whenDisabled });
      }
      return;
    }
    if (onBegin) {
      setState((previous) => ({
        organizationId,
        value: onBegin(
          previous?.organizationId === organizationId ? previous.value : null,
        ),
      }));
    }
    void load().then((value) => {
      if (requestIdRef.current === requestId) {
        setState({ organizationId, value });
      }
    });
    return () => {
      requestIdRef.current++;
    };
  }, [enabled, organizationId, reloadToken, source]);

  return state && state.organizationId === organizationId ? state.value : null;
}
