import { writerByPeerId } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "./DocumentsProvider";

type AttributionSegments = DocumentEditAttributionResponse["segments"];

// A stable empty set so the "no attribution" case does not churn the resolver
// identity on every render.
const NO_SEGMENTS: AttributionSegments = [];

// Resolves a row's last-editor Loro peer id to a server-verified writer user id
// via the document's edit-attribution segments. Returns null when the peer is
// unknown, spans conflicting signing identities, or attribution is unavailable
// (offline, unsynced, unauthenticated, or a local-only document) — callers then
// fall back to the row's self-attested `updatedBy`.
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
  const { containerContents } = useTearleads();
  const runtime = useTearleadsRuntime();
  const isAuthenticated = runtime.auth.isAuthenticated;
  const online = runtime.state.online;
  const [segments, setSegments] = useState<AttributionSegments>(NO_SEGMENTS);

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

  useEffect(() => {
    // The `documentId === null` arm is redundant with `canFetch` but narrows the
    // type for the fetch call below.
    if (!canFetch || documentId === null) {
      setSegments(NO_SEGMENTS);
      return;
    }

    let cancelled = false;
    void containerContents
      .loadDocumentEditAttribution(documentId)
      .then((response) => {
        if (!cancelled) {
          setSegments(selectAttributionSegments(response));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSegments(NO_SEGMENTS);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canFetch, containerContents, documentId, syncCompletions]);

  return useMemo(() => createRowWriterResolver(segments), [segments]);
}
