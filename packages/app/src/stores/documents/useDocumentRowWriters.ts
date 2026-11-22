import { writerByPeerId } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { useCallback, useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import {
  type AttributionReadRequest,
  currentAttributionResult,
} from "./attributionReadMachine";
import { useDocument } from "./DocumentsProvider";
import {
  useAttributionRead,
  useAttributionRequest,
} from "./useAttributionRead";

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

function useAttributionSegmentsForDocument(input: {
  documentId: string | null;
  syncing: boolean;
  enabled: boolean;
}): AttributionSegments {
  const { containerContents } = useTearleads();
  const request = useAttributionRequest(input);
  const load = useCallback(
    ({ documentId }: AttributionReadRequest) =>
      containerContents
        .loadDocumentEditAttribution(documentId)
        .then((response) =>
          selectAttributionSegments(
            response?.documentId === documentId ? response : null,
          ),
        ),
    [containerContents],
  );
  // Only this request's own read: a refresh shows nothing until it is ready.
  return (
    currentAttributionResult(useAttributionRead(request, load), request) ??
    NO_SEGMENTS
  );
}
