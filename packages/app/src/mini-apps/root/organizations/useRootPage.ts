import type { RootRequestOutcome } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeRootFailure, describeThrown } from "../identities/rootDisplay";

interface Page<Item> {
  readonly items: ReadonlyArray<Item>;
  readonly nextCursor: string | null;
}
export function useRootPage<Item>(
  request: (cursor: string | null) => Promise<RootRequestOutcome<Page<Item>>>,
) {
  const [state, setState] = useState<{
    items: ReadonlyArray<Item>;
    nextCursor: string | null;
    loading: boolean;
    error: string | null;
  }>({ items: [], nextCursor: null, loading: true, error: null });
  const sequence = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      const started = ++sequence.current;
      setState((current) => ({
        ...current,
        ...(cursor === null ? { items: [], nextCursor: null } : {}),
        loading: true,
        error: null,
      }));
      let result: RootRequestOutcome<Page<Item>>;
      try {
        result = await request(cursor);
      } catch (error) {
        result = { ok: false, message: describeThrown(error), status: null };
      }
      if (started !== sequence.current) return;
      if (!result.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          error: describeRootFailure(result),
        }));
        return;
      }
      const page = result.data;
      setState((current) => ({
        items: cursor === null ? page.items : [...current.items, ...page.items],
        nextCursor: page.nextCursor,
        loading: false,
        error: null,
      }));
    },
    [request],
  );
  useEffect(() => {
    void load(null);
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  const refresh = useCallback(() => void load(null), [load]);
  const loadMore = () => {
    if (!state.loading && state.nextCursor !== null)
      void load(state.nextCursor);
  };
  return { ...state, refresh, loadMore };
}
