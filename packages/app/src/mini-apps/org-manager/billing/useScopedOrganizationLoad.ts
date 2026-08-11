import { useEffect, useRef, useState } from "react";

interface ScopedOrganizationLoadInput<Value> {
  enabled: boolean;
  /** Loads the value; must resolve (map failures to an error-shaped Value). */
  load: () => Promise<Value>;
  /**
   * Value to show while a load is in flight; receives the previous value when
   * it was produced for the same organization and source. Omit to keep the
   * prior state.
   */
  onBegin?: (previousValue: Value | null) => Value;
  organizationId: string;
  /** Re-runs the load when it changes. */
  reloadToken?: unknown;
  /**
   * Identity of what `load` reads (the SDK runtime). Scopes the state and
   * re-runs the load when it is replaced, so a new runtime neither serves nor
   * seeds from state the old runtime fetched — not even while its own first
   * load is in flight.
   */
  source: unknown;
  /** Value recorded while disabled; omit to keep the prior state. */
  whenDisabled?: Value;
}

/**
 * Shared skeleton for the billing panel's per-organization fetches: runs
 * `load` whenever the organization, enabled state, source, or reload token
 * change, drops stale responses, and only reports a value that was produced
 * for the organization and source on screen (returning null otherwise) so
 * nothing leaks across an org or identity switch.
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
    source: unknown;
    value: Value;
  } | null>(null);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const { load, onBegin, whenDisabled } = inputRef.current;
    if (!enabled) {
      if (whenDisabled !== undefined) {
        setState({ organizationId, source, value: whenDisabled });
      }
      return;
    }
    if (onBegin) {
      setState((previous) => ({
        organizationId,
        source,
        value: onBegin(
          previous?.organizationId === organizationId &&
            previous.source === source
            ? previous.value
            : null,
        ),
      }));
    }
    void load().then((value) => {
      if (requestIdRef.current === requestId) {
        setState({ organizationId, source, value });
      }
    });
    return () => {
      requestIdRef.current++;
    };
  }, [enabled, organizationId, reloadToken, source]);

  return state &&
    state.organizationId === organizationId &&
    state.source === source
    ? state.value
    : null;
}
