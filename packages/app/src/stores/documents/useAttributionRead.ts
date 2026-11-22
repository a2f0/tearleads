import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  type AttributionReadEvent,
  type AttributionReadRequest,
  type AttributionReadState,
  transitionAttributionRead,
} from "./attributionReadMachine";

// Attribution is a synced-remote, authenticated, online concern. A local-only
// document (no documentId), an offline/unauthenticated session, or a caller that
// will not render row attribution has nothing worth fetching.
export function shouldFetchAttribution(input: {
  documentId: string | null;
  enabled: boolean;
  isAuthenticated: boolean;
  online: boolean;
}): boolean {
  return (
    input.enabled &&
    input.documentId !== null &&
    input.isAuthenticated &&
    input.online
  );
}

/**
 * The request for one attribution read: a new object whenever the document,
 * the session, or a completed sync should start another, and null when there
 * is nothing to fetch. Its `scope` changes only with the document or the
 * session. Readers key their read on the request's identity.
 */
export function useAttributionRequest({
  documentId,
  syncing,
  enabled,
}: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): AttributionReadRequest | null {
  const { containerContents } = useTearleads();
  const runtime = useTearleadsRuntime();
  const { isAuthenticated, organizationId, userId, authToken } = runtime.auth;
  const { signingFingerprint } = runtime.crypto;
  const { online, domainScope } = runtime.state;

  // Re-fetch after each sync cycle completes: a sync can pull in rows written by
  // peers the current segment set does not yet cover, whose server attribution
  // is now available.
  const [syncCompletions, setSyncCompletions] = useState(0);
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) {
      setSyncCompletions((count) => count + 1);
    }
    wasSyncing.current = syncing;
  }, [syncing]);

  const canFetch = shouldFetchAttribution({
    documentId,
    enabled,
    isAuthenticated,
    online,
  });

  const scope = useMemo(
    () =>
      canFetch && documentId !== null
        ? {
            documentId,
            containerContents,
            organizationId,
            userId,
            authToken,
            signingFingerprint,
            domainScope,
          }
        : null,
    [
      canFetch,
      containerContents,
      documentId,
      organizationId,
      userId,
      authToken,
      signingFingerprint,
      domainScope,
    ],
  );
  return useMemo(
    () =>
      scope === null
        ? null
        : { documentId: scope.documentId, scope, syncCompletions },
    [scope, syncCompletions],
  );
}

/** What a read is told when it starts. */
export interface AttributionReadContext<Result> {
  /** Whether its request is still the current one, so a long read can stop. */
  readonly isCurrent: () => boolean;
  /** The latest result read in its scope, which it refreshes; or null. */
  readonly previous: Result | null;
}

/**
 * Run one attribution read per request, through `transitionAttributionRead`.
 * `load` resolves null for a read that yielded nothing usable, and its result
 * is dropped if its request is no longer the current one. Readers project the
 * state with `currentAttributionResult` or `heldAttributionResult`.
 */
export function useAttributionRead<Result>(
  request: AttributionReadRequest | null,
  load: (
    request: AttributionReadRequest,
    context: AttributionReadContext<Result>,
  ) => Promise<Result | null>,
): AttributionReadState<Result> {
  const [state, dispatch] = useReducer(
    (
      current: AttributionReadState<Result>,
      event: AttributionReadEvent<Result>,
    ) => transitionAttributionRead<Result>(current, event),
    { status: "idle" },
  );
  useEffect(() => dispatch({ type: "request", request }), [request]);
  const loading = state.status === "loading" ? state : null;
  useEffect(() => {
    if (!loading || loading.request !== request) return;
    let active = true;
    void load(request, {
      isCurrent: () => active,
      previous: loading.previous,
    }).then(
      (result) => {
        if (!active) return;
        dispatch(
          result === null
            ? { type: "failed", request }
            : { type: "loaded", request, result },
        );
      },
      () => {
        if (active) dispatch({ type: "failed", request });
      },
    );
    return () => {
      active = false;
    };
  }, [load, loading, request]);
  return state;
}
