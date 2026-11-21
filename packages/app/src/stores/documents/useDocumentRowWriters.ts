import { writerByPeerId } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "./DocumentsProvider";
import {
  type RowWritersEvent,
  type RowWritersRequest,
  type RowWritersState,
  transitionRowWriters,
} from "./rowWritersMachine";

type AttributionSegments = DocumentEditAttributionResponse["segments"];

// A stable empty set so the "no attribution" case does not churn the resolver
// identity on every render.
const NO_SEGMENTS: AttributionSegments = [];

// Resolves a row's Loro peer id to a server-verified signed uploader, not proof
// of original authorship. Unknown/conflicting peers and unavailable attribution
// (offline, unsynced, unauthenticated, local-only) resolve to null; this resolver
// never substitutes a row's self-attested `updatedBy`.
export type RowWriterResolver = (updatedByPeer: string | null) => string | null;

// A truncated interval list can drop some of a peer's segments, which would let
// writerByPeerId resolve a peer that actually spans conflicting identities to a
// single (wrong) writer — the SDK's own attribution consumers refuse truncated
// data for exactly this reason. Use the segments only when the response is
// complete.
export function selectAttributionSegments(
  response: DocumentEditAttributionResponse | null,
): AttributionSegments {
  if (!response || response.truncated) {
    return NO_SEGMENTS;
  }
  return response.segments;
}

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

// Build the peer -> verified-writer resolver from a set of attribution segments.
// Pure, so the resolution rules are testable without the SDK context: a peer
// whose ops span conflicting identities maps to null in `writerByPeerId`, and an
// unknown peer is absent from the map — both collapse to "unresolved" here, as
// does a null peer (a row Loro never recorded an editor for).
export function createRowWriterResolver(
  segments: AttributionSegments,
): RowWriterResolver {
  const writerByPeer = writerByPeerId(segments);
  return (updatedByPeer) => {
    if (updatedByPeer === null) {
      return null;
    }
    return writerByPeer.get(updatedByPeer)?.writerUserId ?? null;
  };
}

// Fetch the open document's edit-attribution segments (reusing the existing
// attribution request — no new endpoint) and expose a peer -> verified-writer
// resolver. `enabled` lets a caller skip the fetch when the result is unused.
export function useDocumentRowWriters(enabled: boolean): RowWriterResolver {
  const { documentId, syncing } = useDocument();
  return useRowWritersForDocument({ documentId, syncing, enabled });
}

// The open document's complete edit-attribution segments, for callers that
// resolve an exact operation rather than a peer. Empty while they load or when
// attribution is unavailable (offline, unsynced, unauthenticated, truncated).
export function useDocumentAttributionSegments(
  enabled: boolean,
): AttributionSegments {
  const { documentId, syncing } = useDocument();
  return useAttributionSegmentsForDocument({ documentId, syncing, enabled });
}

// Contacts and other hosts can request attribution without a DocumentProvider.
// Both entry points share the same policy and exact request-scope lifetime.
export function useRowWritersForDocument(input: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): RowWriterResolver {
  const segments = useAttributionSegmentsForDocument(input);
  return useMemo(() => createRowWriterResolver(segments), [segments]);
}

/** One attribution read's scope, as its readers see it. */
export interface AttributionRequest extends RowWritersRequest {
  /**
   * The document and session the read belongs to. It outlives the refresh
   * after each sync, so a reader can tell a refresh of what it holds from a
   * read for another document or session.
   */
  readonly scope: object;
}

/**
 * The scope of one attribution read: a new object whenever the document, the
 * session, or a completed sync should start another, and null when there is
 * nothing to fetch. Readers key their request on its identity.
 */
export function useAttributionRequest({
  documentId,
  syncing,
  enabled,
}: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): AttributionRequest | null {
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

/**
 * Run one attribution read per request and yield its result, or null until
 * the current request's read is ready (loading, failed, or nothing to
 * fetch). `load` resolves null for a read that yielded nothing usable. It is
 * told whether its request is still the current one, so a long read can stop
 * early, and its result is dropped if it is not.
 */
export function useAttributionRead<Request extends RowWritersRequest, Result>(
  request: Request | null,
  load: (request: Request, isCurrent: () => boolean) => Promise<Result | null>,
): Result | null {
  const [state, dispatch] = useReducer(
    (current: RowWritersState<Result>, event: RowWritersEvent<Result>) =>
      transitionRowWriters<Result>(current, event),
    { status: "idle" },
  );
  useEffect(() => dispatch({ type: "request", request }), [request]);
  const loading = state.status === "loading" ? state.request : null;
  useEffect(() => {
    if (!loading || loading !== request) return;
    let active = true;
    void load(request, () => active).then(
      (result) => {
        if (!active) return;
        dispatch(
          result === null
            ? { type: "failed", request: loading }
            : { type: "loaded", request: loading, segments: result },
        );
      },
      () => {
        if (active) dispatch({ type: "failed", request: loading });
      },
    );
    return () => {
      active = false;
    };
  }, [load, loading, request]);
  // Effects clear state after commit; projection must already hide an old
  // document's identity during the very first render of the new scope.
  return state.status === "ready" && state.request === request
    ? state.segments
    : null;
}

function useAttributionSegmentsForDocument(input: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): AttributionSegments {
  const { containerContents } = useTearleads();
  const request = useAttributionRequest(input);
  const load = useCallback(
    ({ documentId }: RowWritersRequest) =>
      containerContents
        .loadDocumentEditAttribution(documentId)
        .then((response) =>
          selectAttributionSegments(
            response?.documentId === documentId ? response : null,
          ),
        ),
    [containerContents],
  );
  return useAttributionRead(request, load) ?? NO_SEGMENTS;
}
