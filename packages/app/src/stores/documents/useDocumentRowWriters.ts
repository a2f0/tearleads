import { type Tearleads, writerByPeerId } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "./DocumentsProvider";
import {
  type RowWritersRequest,
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

// Contacts and other hosts can request attribution without a DocumentProvider.
// Both entry points share the same policy and exact request-scope lifetime.
export function useRowWritersForDocument({
  documentId,
  syncing,
  enabled,
}: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): RowWriterResolver {
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

  const request = useMemo(
    () =>
      canFetch && documentId !== null
        ? {
            documentId,
            containerContents,
            syncCompletions,
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
      syncCompletions,
      organizationId,
      userId,
      authToken,
      signingFingerprint,
      domainScope,
    ],
  );
  const segments = useRowWriterSegments(request, containerContents);
  return useMemo(() => createRowWriterResolver(segments), [segments]);
}

function useRowWriterSegments(
  request: RowWritersRequest | null,
  containerContents: Tearleads["containerContents"],
): AttributionSegments {
  const [state, dispatch] = useReducer(transitionRowWriters, {
    status: "idle",
  });
  useEffect(() => dispatch({ type: "request", request }), [request]);
  const loading = state.status === "loading" ? state.request : null;
  useEffect(() => {
    if (!loading || loading !== request) return;
    let active = true;
    void containerContents.loadDocumentEditAttribution(loading.documentId).then(
      (response) => {
        if (active)
          dispatch({
            type: "loaded",
            request: loading,
            segments: selectAttributionSegments(
              response?.documentId === loading.documentId ? response : null,
            ),
          });
      },
      () => {
        if (active) dispatch({ type: "failed", request: loading });
      },
    );
    return () => {
      active = false;
    };
  }, [containerContents, loading, request]);
  // Effects clear state after commit; projection must already hide an old
  // document's identity during the very first render of the new scope.
  return state.status === "ready" && state.request === request
    ? state.segments
    : NO_SEGMENTS;
}
