import type {
  DocumentAttributionRangesPage,
  DocumentInfo,
} from "@symcrypt/client-sdk";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import type { ExplorerDocumentAttributionRangesLoader } from "../../../../stores/explorer/documentInfo";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import type { ExplorerAttributionProfileHydrationRequester } from "../../hooks/explorerAttributionReadModel";
import { EXPLORER_LABELS } from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";
import { compactId } from "../compactId";

const EDIT_RANGES_PAGE_SIZE = 100;

interface EditRangesState {
  attributionRevision: number | null;
  error: string | null;
  isLoading: boolean;
  items: DocumentAttributionRangesPage["items"];
  nextCursor: string | null;
}

function createEmptyEditRangesState(): EditRangesState {
  return {
    attributionRevision: null,
    error: null,
    isLoading: false,
    items: [],
    nextCursor: null,
  };
}

function getEditRangeAuthorityLabel(
  authorityKind: DocumentAttributionRangesPage["items"][number]["authorityKind"],
): string {
  return authorityKind === "direct"
    ? EXPLORER_LABELS.documentInfoEditRangeAuthorityDirect
    : EXPLORER_LABELS.documentInfoEditRangeAuthorityReasserted;
}

function EditRangesTable(params: {
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  items: DocumentAttributionRangesPage["items"];
}) {
  return (
    <MiniAppInfoTable>
      <thead>
        <tr>
          <th>{EXPLORER_LABELS.documentInfoEditRangeWriterColumn}</th>
          <th>{EXPLORER_LABELS.documentInfoEditRangePeerColumn}</th>
          <th>{EXPLORER_LABELS.documentInfoEditRangeRangeColumn}</th>
          <th>{EXPLORER_LABELS.documentInfoEditRangeOpsColumn}</th>
          <th>{EXPLORER_LABELS.documentInfoEditRangeUploadColumn}</th>
          <th>{EXPLORER_LABELS.documentInfoEditRangeAuthorityColumn}</th>
        </tr>
      </thead>
      <tbody>
        {params.items.map((item) => (
          <tr
            key={`${item.updateId}:${item.peerId}:${item.startCounter}:${item.endCounter}`}
          >
            <td
              title={getExplorerAttributionWriterTitle(
                item,
                params.attributionUserLabelResolver,
              )}
            >
              {getExplorerAttributionWriterLabel(
                item,
                params.attributionUserLabelResolver,
              )}
            </td>
            <td title={item.peerId}>{compactId(item.peerId)}</td>
            <td>{`${item.startCounter}–${item.endCounter}`}</td>
            <td>{String(item.endCounter - item.startCounter)}</td>
            <td title={item.updateId}>{compactId(item.updateId)}</td>
            <td>{getEditRangeAuthorityLabel(item.authorityKind)}</td>
          </tr>
        ))}
      </tbody>
    </MiniAppInfoTable>
  );
}

async function requestEditRangesPage(input: {
  cursor: string | null;
  documentId: string;
  expectedRevision: number | null;
  load: ExplorerDocumentAttributionRangesLoader;
}): Promise<DocumentAttributionRangesPage> {
  const page = await input.load({
    cursor: input.cursor,
    documentId: input.documentId,
    ...(input.expectedRevision === null
      ? {}
      : { expectedRevision: input.expectedRevision }),
    limit: EDIT_RANGES_PAGE_SIZE,
  });
  if (page.documentId !== input.documentId) {
    throw new Error(EXPLORER_LABELS.documentInfoEditRangesDocumentChanged);
  }
  if (
    input.expectedRevision !== null &&
    page.attributionRevision !== input.expectedRevision
  ) {
    throw new Error(EXPLORER_LABELS.documentInfoEditRangesRevisionChanged);
  }
  return page;
}

function useEditRangesState(input: {
  attributionScopeKey: string | null;
  compactAttributionRevision: number | null;
  documentId: string | null;
  load: ExplorerDocumentAttributionRangesLoader;
  requestAttributionProfileHydration?:
    | ExplorerAttributionProfileHydrationRequester
    | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState(createEmptyEditRangesState);
  const requestIdRef = useRef(0);

  useLayoutEffect(() => {
    requestIdRef.current += 1;
    setExpanded(false);
    setState(createEmptyEditRangesState());
    return () => {
      requestIdRef.current += 1;
    };
  }, [
    input.attributionScopeKey,
    input.compactAttributionRevision,
    input.documentId,
  ]);

  const loadPage = useCallback(
    async (cursor: string | null, expectedRevision: number | null) => {
      if (!input.documentId) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState((current) => ({
        ...current,
        error: null,
        isLoading: true,
      }));

      try {
        const page = await requestEditRangesPage({
          cursor,
          documentId: input.documentId,
          expectedRevision,
          load: input.load,
        });
        if (requestIdRef.current !== requestId) {
          return;
        }
        const contributorUserIds = [
          ...new Set(page.items.map((item) => item.writerUserId)),
        ];
        if (contributorUserIds.length > 0) {
          input.requestAttributionProfileHydration?.({
            contributorUserIds,
            documentId: page.documentId,
          });
        }
        setState((current) => ({
          attributionRevision: page.attributionRevision,
          error: null,
          isLoading: false,
          items:
            cursor === null ? page.items : [...current.items, ...page.items],
          nextCursor: page.nextCursor,
        }));
      } catch (error) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setState((current) => ({
          ...current,
          error: unknownErrorMessage(error),
          isLoading: false,
        }));
      }
    },
    [input.documentId, input.load, input.requestAttributionProfileHydration],
  );

  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (state.items.length === 0 && !state.isLoading) {
      void loadPage(null, input.compactAttributionRevision);
    }
  };
  return { expanded, loadPage, state, toggleExpanded };
}

function ExpandedEditRanges(params: {
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  loadMore: () => void;
  retry: () => void;
  state: EditRangesState;
}) {
  const { state } = params;
  return (
    <>
      {state.items.length > 0 ? (
        <EditRangesTable
          attributionUserLabelResolver={params.attributionUserLabelResolver}
          items={state.items}
        />
      ) : null}
      {state.isLoading ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoEditRangesLoading}
        </MiniAppStatus>
      ) : null}
      {state.error ? (
        <>
          <MiniAppStatus tone="error">{state.error}</MiniAppStatus>
          <MiniAppButton
            className="explorer-info-inline-action"
            onClick={params.retry}
          >
            {EXPLORER_LABELS.retry}
          </MiniAppButton>
        </>
      ) : null}
      {!state.isLoading && !state.error && state.items.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoEditRangesEmpty}
        </MiniAppStatus>
      ) : null}
      {!state.isLoading && !state.error && state.nextCursor ? (
        <MiniAppButton
          className="explorer-info-inline-action"
          onClick={params.loadMore}
        >
          {EXPLORER_LABELS.documentInfoEditRangesLoadMore}
        </MiniAppButton>
      ) : null}
    </>
  );
}

export function ExplorerDocumentInfoEditRangesSection(params: {
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  documentInfo: DocumentInfo | null;
  loadDocumentAttributionRanges: ExplorerDocumentAttributionRangesLoader;
  requestAttributionProfileHydration?:
    | ExplorerAttributionProfileHydrationRequester
    | undefined;
}) {
  const remoteInfo = params.documentInfo?.remoteInfo;
  const documentId = params.documentInfo?.local.documentId ?? null;
  const compactAttributionRevision = remoteInfo?.attributionRevision ?? null;
  const model = useEditRangesState({
    attributionScopeKey: remoteInfo?.currentManifestHash ?? null,
    compactAttributionRevision,
    documentId,
    load: params.loadDocumentAttributionRanges,
    requestAttributionProfileHydration:
      params.requestAttributionProfileHydration,
  });

  if (
    !remoteInfo ||
    remoteInfo.attributionStatus === "unavailable" ||
    (remoteInfo.attributionStatus === "available" &&
      remoteInfo.attributionSegments.length === 0) ||
    compactAttributionRevision === null ||
    !documentId
  ) {
    return null;
  }

  const retry = () => {
    // A failed cursor or expected revision is not recoverable by replaying the
    // same request. Restart from the current server scope and let that first
    // page pin the revision used by subsequent pages.
    void model.loadPage(null, null);
  };
  const loadMore = () => {
    if (model.state.nextCursor) {
      void model.loadPage(
        model.state.nextCursor,
        model.state.attributionRevision,
      );
    }
  };

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoEditRangesHeading}>
      <MiniAppButton
        aria-expanded={model.expanded}
        className="explorer-info-inline-action"
        onClick={model.toggleExpanded}
      >
        {model.expanded
          ? EXPLORER_LABELS.documentInfoEditRangesHide
          : EXPLORER_LABELS.documentInfoEditRangesShow}
      </MiniAppButton>
      {model.expanded ? (
        <ExpandedEditRanges
          attributionUserLabelResolver={params.attributionUserLabelResolver}
          loadMore={loadMore}
          retry={retry}
          state={model.state}
        />
      ) : null}
    </MiniAppInfoSection>
  );
}
