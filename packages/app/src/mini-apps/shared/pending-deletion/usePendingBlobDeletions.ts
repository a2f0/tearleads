import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  type PendingBlobDeletionLoader,
  type PendingBlobDeletionState,
  transitionPendingBlobDeletion,
} from "./pendingBlobDeletionState";

const INITIAL_STATE: PendingBlobDeletionState = { status: "idle" };

export function usePendingBlobDeletions(request: PendingBlobDeletionLoader) {
  const [state, dispatch] = useReducer(
    transitionPendingBlobDeletion,
    INITIAL_STATE,
  );
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    dispatch({
      type: "load",
      cursor: null,
      request,
      requestId: ++sequence.current,
    });
  }, [request]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (state.status !== "loading") return;
    let current = true;
    const { requestId } = state;
    void state.request(state.cursor).then(
      (result) => {
        if (!current) return;
        dispatch(
          result.ok
            ? { type: "resolved", requestId, page: result.data }
            : { type: "failed", requestId, message: result.message },
        );
      },
      (error: unknown) => {
        if (!current) return;
        dispatch({
          type: "failed",
          requestId,
          message:
            error instanceof Error
              ? error.message
              : "Could not load pending deletions.",
        });
      },
    );
    return () => {
      current = false;
    };
  }, [state]);

  const loadMore = () => {
    if (state.status === "ready" && state.nextAfterId !== null) {
      dispatch({
        type: "load",
        cursor: state.nextAfterId,
        request,
        requestId: ++sequence.current,
      });
    }
  };
  return { state, refresh, loadMore };
}
