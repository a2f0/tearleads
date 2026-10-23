import type { RootOpsHealthReport } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "../identities/rootDisplay";

interface RootOpsHealthReportState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly report: RootOpsHealthReport | null;
}

/** Loads the ops-health report; a refresh drops any reply still in flight. */
export function useRootOpsHealthReport() {
  const tearleads = useTearleads();
  const [state, setState] = useState<RootOpsHealthReportState>({
    error: null,
    loading: false,
    report: null,
  });
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState((current) => ({ ...current, error: null, loading: true }));
    let outcome: Awaited<ReturnType<typeof tearleads.root.loadOpsHealthReport>>;
    try {
      outcome = await tearleads.root.loadOpsHealthReport();
    } catch (error) {
      outcome = { message: describeThrown(error), ok: false, status: null };
    }
    if (sequence !== requestSequence.current) return;
    setState(
      outcome.ok
        ? { error: null, loading: false, report: outcome.data }
        : { error: describeRootFailure(outcome), loading: false, report: null },
    );
  }, [tearleads]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  return { ...state, refresh };
}
