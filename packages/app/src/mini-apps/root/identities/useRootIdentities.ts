import type { RootIdentity } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "./rootDisplay";

interface RootIdentitiesState {
  readonly error: string | null;
  readonly identities: ReadonlyArray<RootIdentity>;
  readonly loading: boolean;
  readonly nextCursor: string | null;
}

const EMPTY_STATE: RootIdentitiesState = {
  error: null,
  identities: [],
  loading: false,
  nextCursor: null,
};

/**
 * Pages the platform identity listing. A changed fingerprint filter restarts
 * from the first page; `loadMore` appends the next page. Responses that land
 * after a newer request started are discarded.
 */
export function useRootIdentities(fingerprint: string | null) {
  const tearleads = useTearleads();
  const [state, setState] = useState<RootIdentitiesState>(EMPTY_STATE);
  const requestSequence = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      const sequence = ++requestSequence.current;
      setState((current) => ({
        ...current,
        error: null,
        identities: cursor === null ? [] : current.identities,
        loading: true,
        // A restart forgets the previous continuation so a failed reload
        // cannot resume paging past identities it never showed.
        nextCursor: cursor === null ? null : current.nextCursor,
      }));
      let outcome: Awaited<ReturnType<typeof tearleads.root.listIdentities>>;
      try {
        outcome = await tearleads.root.listIdentities({
          ...(cursor === null ? {} : { cursor }),
          ...(fingerprint === null ? {} : { fingerprint }),
        });
      } catch (error) {
        outcome = { message: describeThrown(error), ok: false, status: null };
      }
      if (sequence !== requestSequence.current) {
        return;
      }
      if (!outcome.ok) {
        setState((current) => ({
          ...current,
          error: describeRootFailure(outcome),
          loading: false,
        }));
        return;
      }
      setState((current) => ({
        error: null,
        identities:
          cursor === null
            ? outcome.data.identities
            : [...current.identities, ...outcome.data.identities],
        loading: false,
        nextCursor: outcome.data.nextCursor,
      }));
    },
    [fingerprint, tearleads],
  );

  useEffect(() => {
    void load(null);
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const refresh = useCallback(() => void load(null), [load]);
  const loadMore = useCallback(() => {
    if (state.nextCursor !== null && !state.loading) {
      void load(state.nextCursor);
    }
  }, [load, state.loading, state.nextCursor]);

  return { ...state, loadMore, refresh };
}
