import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInfoSection,
  MiniAppInput,
  MiniAppPanel,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppInfoTable,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import { formatByteLength } from "../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerBlobBrowserDocumentCountLabel,
  getExplorerBlobBrowserReferenceCountLabel,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../labels";
import type { ExplorerRoute } from "../routes";

const BLOB_BROWSER_LIMIT = 200;
const BLOB_TEXT_PREVIEW_LIMIT = 64 * 1024;

type BlobBrowserRoute = Extract<ExplorerRoute, { view: "blob-browser" }>;

type BlobPreviewState =
  | { status: "idle"; text: null; truncated: false; url: null }
  | { status: "loading"; text: null; truncated: false; url: null }
  | { status: "missing"; text: null; truncated: false; url: null }
  | { status: "error"; error: string; text: null; truncated: false; url: null }
  | {
      status: "ready";
      byteLength: number;
      text: string | null;
      truncated: boolean;
      url: string | null;
    };

interface BlobInfoListState {
  error: string | null;
  isLoading: boolean;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
}

function compactId(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value.length <= 18
    ? value
    : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBlobRouteQuery(route: BlobBrowserRoute): string {
  return route.blobId ?? route.storageKey ?? "";
}

function getBlobChangedAt(blob: BlobInfo): string | null {
  return blob.updatedAt ?? blob.createdAt;
}

function getContainerNameById(
  nodes: ReadonlyArray<ContainerNode>,
): ReadonlyMap<string, string> {
  return new Map(nodes.map((node) => [node.id, node.name]));
}

function getBlobInfoColumns(): ReadonlyArray<MiniAppTableColumn> {
  return [
    {
      header: EXPLORER_LABELS.blobBrowserBlobColumn,
      id: "blob",
      width: "34%",
    },
    {
      header: EXPLORER_LABELS.blobBrowserMimeTypeColumn,
      id: "mime",
      width: "11rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserSizeColumn,
      id: "size",
      width: "7rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserReferenceColumn,
      id: "references",
      width: "8rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserUpdatedColumn,
      id: "updated",
      width: "11rem",
    },
  ];
}

function getBlobReferenceColumns(): ReadonlyArray<MiniAppTableColumn> {
  return [
    {
      header: EXPLORER_LABELS.blobBrowserDocumentColumn,
      id: "document",
      width: "38%",
    },
    {
      header: EXPLORER_LABELS.documentInfoContainerColumn,
      id: "container",
      width: "24%",
    },
    {
      header: EXPLORER_LABELS.blobBrowserStateColumn,
      id: "state",
      width: "6rem",
    },
    {
      header: EXPLORER_LABELS.blobBrowserSlotColumn,
      id: "slot",
      width: "8rem",
    },
    {
      header: "",
      id: "actions",
      width: "8rem",
    },
  ];
}

function useBlobInfoList(params: {
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  query: string;
}) {
  const { loadBlobInfo, query } = params;
  const [state, setState] = useState<BlobInfoListState>({
    error: null,
    isLoading: false,
    rows: [],
    totalCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, error: null, isLoading: true }));

    void loadBlobInfo({
      limit: BLOB_BROWSER_LIMIT,
      query,
    })
      .then((result) => {
        if (!cancelled) {
          setState({
            error: null,
            isLoading: false,
            rows: result.rows,
            totalCount: result.totalCount,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: unknownErrorMessage(error),
            isLoading: false,
            rows: [],
            totalCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadBlobInfo, query]);

  return state;
}

function isTextMimeType(mimeType: string | null): boolean {
  return (
    mimeType?.startsWith("text/") === true ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "image/svg+xml"
  );
}

function isImageMimeType(mimeType: string | null): boolean {
  return mimeType?.startsWith("image/") === true;
}

function canCreateObjectUrl(): boolean {
  return typeof URL === "function" && typeof URL.createObjectURL === "function";
}

function decodePreviewText(bytes: Uint8Array<ArrayBuffer>): {
  text: string;
  truncated: boolean;
} {
  const truncated = bytes.byteLength > BLOB_TEXT_PREVIEW_LIMIT;
  const previewBytes = truncated
    ? bytes.slice(0, BLOB_TEXT_PREVIEW_LIMIT)
    : bytes;

  return {
    text: new TextDecoder().decode(previewBytes),
    truncated,
  };
}

async function readBlobPreview(input: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): Promise<{ objectUrl: string | null; state: BlobPreviewState }> {
  const bytes = await input.blobStore.readBytes(input.blob.storageKey);
  if (!bytes) {
    return {
      objectUrl: null,
      state: {
        status: "missing",
        text: null,
        truncated: false,
        url: null,
      },
    };
  }

  const mimeType = input.blob.mimeType ?? "application/octet-stream";
  const objectUrl = canCreateObjectUrl()
    ? URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    : null;
  const textPreview = isTextMimeType(input.blob.mimeType)
    ? decodePreviewText(bytes)
    : null;

  return {
    objectUrl,
    state: {
      byteLength: bytes.byteLength,
      status: "ready",
      text: textPreview?.text ?? null,
      truncated: textPreview?.truncated ?? false,
      url: objectUrl,
    },
  };
}

function useBlobPreview(params: {
  blob: BlobInfo | null;
  blobStore: BlobStore;
}): BlobPreviewState {
  const { blob, blobStore } = params;
  const [state, setState] = useState<BlobPreviewState>({
    status: "idle",
    text: null,
    truncated: false,
    url: null,
  });

  useEffect(() => {
    if (!blob) {
      setState({
        status: "idle",
        text: null,
        truncated: false,
        url: null,
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setState({
      status: "loading",
      text: null,
      truncated: false,
      url: null,
    });

    void readBlobPreview({ blob, blobStore })
      .then((preview) => {
        if (cancelled) {
          if (preview.objectUrl) {
            URL.revokeObjectURL(preview.objectUrl);
          }
          return;
        }

        objectUrl = preview.objectUrl;
        setState(preview.state);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: unknownErrorMessage(error),
            status: "error",
            text: null,
            truncated: false,
            url: null,
          });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blob, blobStore]);

  return state;
}

function matchesRouteTarget(blob: BlobInfo, route: BlobBrowserRoute): boolean {
  if (route.blobId && blob.blobId === route.blobId) {
    return true;
  }

  if (!route.storageKey) {
    return false;
  }

  return (
    blob.storageKey === route.storageKey ||
    blob.references.some(
      (reference) => reference.storageKey === route.storageKey,
    )
  );
}

function getSelectedBlob(params: {
  activeBlobKey: string | null;
  route: BlobBrowserRoute;
  rows: ReadonlyArray<BlobInfo>;
}): BlobInfo | null {
  const activeBlob = params.activeBlobKey
    ? params.rows.find((blob) => blob.key === params.activeBlobKey)
    : null;
  if (activeBlob) {
    return activeBlob;
  }

  return (
    params.rows.find((blob) => matchesRouteTarget(blob, params.route)) ??
    params.rows[0] ??
    null
  );
}

function BlobInfoTable(params: {
  activeBlob: BlobInfo | null;
  error: string | null;
  isLoading: boolean;
  onSelectBlob: (blob: BlobInfo) => void;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
}) {
  const columns = useMemo(() => getBlobInfoColumns(), []);

  return (
    <MiniAppTableFrame className="explorer-blob-browser-table-wrap">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.blobBrowserTitle}
        columns={columns}
      >
        {params.rows.length > 0 ? (
          params.rows.map((blob) => (
            <MiniAppTableRow
              interactive
              key={blob.key}
              selected={params.activeBlob?.key === blob.key}
            >
              <MiniAppTableCell title={blob.blobId ?? blob.storageKey}>
                <MiniAppTableActionButton
                  onClick={() => params.onSelectBlob(blob)}
                >
                  {compactId(blob.blobId ?? blob.storageKey)}
                </MiniAppTableActionButton>
              </MiniAppTableCell>
              <MiniAppTableCell>{blob.mimeType ?? "-"}</MiniAppTableCell>
              <MiniAppTableCell>
                {formatByteLength(blob.byteLength)}
              </MiniAppTableCell>
              <MiniAppTableCell>
                {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
              </MiniAppTableCell>
              <MiniAppTableCell title={getBlobChangedAt(blob) ?? undefined}>
                {formatMiniAppDateTime(getBlobChangedAt(blob), {
                  emptyFallback: "-",
                })}
              </MiniAppTableCell>
            </MiniAppTableRow>
          ))
        ) : params.isLoading ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.blobBrowserLoading}
          </MiniAppTableEmptyRow>
        ) : params.error ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {params.error}
          </MiniAppTableEmptyRow>
        ) : (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.blobBrowserEmpty}
          </MiniAppTableEmptyRow>
        )}
      </MiniAppTable>
      {params.totalCount > params.rows.length ? (
        <MiniAppStatus as="span">
          {params.rows.length}/{params.totalCount}
        </MiniAppStatus>
      ) : null}
    </MiniAppTableFrame>
  );
}

function BlobMetadataSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserMetadataHeading}>
      <MiniAppInfoTable>
        <tbody>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserIdRow}</th>
            <td title={blob.blobId ?? undefined}>{compactId(blob.blobId)}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserStorageKeyRow}</th>
            <td title={blob.storageKey}>{compactId(blob.storageKey)}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserMimeTypeRow}</th>
            <td>{blob.mimeType ?? "-"}</td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserByteLengthRow}</th>
            <td>
              {formatByteLength(
                preview.status === "ready"
                  ? preview.byteLength
                  : blob.byteLength,
              )}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserReferenceColumn}</th>
            <td>
              {getExplorerBlobBrowserReferenceCountLabel(blob.referenceCount)}
              {", "}
              {getExplorerBlobBrowserDocumentCountLabel(blob.documentCount)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.blobBrowserUpdatedRow}</th>
            <td title={getBlobChangedAt(blob) ?? undefined}>
              {formatMiniAppDateTime(getBlobChangedAt(blob), {
                emptyFallback: "-",
              })}
            </td>
          </tr>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function BlobPreviewSection(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { preview } = params;
  const canOpen = preview.status === "ready" && Boolean(preview.url);

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserPreviewHeading}>
      <MiniAppActions className="explorer-blob-browser-preview-actions">
        <MiniAppButton
          disabled={!canOpen}
          onClick={() => {
            if (preview.status === "ready" && preview.url) {
              window.open(preview.url, "_blank", "noopener,noreferrer");
            }
          }}
        >
          {EXPLORER_LABELS.blobBrowserOpenBlobAction}
        </MiniAppButton>
      </MiniAppActions>
      <div className="explorer-blob-preview-frame">
        <BlobPreviewContent blob={params.blob} preview={preview} />
      </div>
    </MiniAppInfoSection>
  );
}

function BlobPreviewContent(params: {
  blob: BlobInfo;
  preview: BlobPreviewState;
}) {
  const { blob, preview } = params;

  if (preview.status === "loading") {
    return <MiniAppStatus>{EXPLORER_LABELS.blobBrowserLoading}</MiniAppStatus>;
  }

  if (preview.status === "missing") {
    return (
      <MiniAppStatus>
        {EXPLORER_LABELS.blobBrowserLocalBytesMissing}
      </MiniAppStatus>
    );
  }

  if (preview.status === "error") {
    return <MiniAppStatus tone="error">{preview.error}</MiniAppStatus>;
  }

  if (preview.status !== "ready") {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoPreview}</MiniAppStatus>
    );
  }

  if (preview.url && isImageMimeType(blob.mimeType)) {
    return (
      <img
        alt={blob.name ?? blob.blobId ?? blob.storageKey}
        className="explorer-blob-preview-image"
        src={preview.url}
      />
    );
  }

  if (preview.text !== null) {
    return (
      <>
        <pre className="explorer-blob-preview-text">{preview.text}</pre>
        {preview.truncated ? (
          <MiniAppStatus>
            {EXPLORER_LABELS.blobBrowserTextTruncated}
          </MiniAppStatus>
        ) : null}
      </>
    );
  }

  return <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoPreview}</MiniAppStatus>;
}

function BlobReferencesSection(params: {
  blob: BlobInfo;
  containerNamesById: ReadonlyMap<string, string>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
}) {
  const columns = useMemo(() => getBlobReferenceColumns(), []);

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserReferencesHeading}>
      <MiniAppTableFrame>
        <MiniAppTable
          aria-label={EXPLORER_LABELS.blobBrowserReferencesHeading}
          columns={columns}
        >
          {params.blob.references.map((reference) => {
            const containerName = reference.containerId
              ? params.containerNamesById.get(reference.containerId)
              : null;
            const canOpenDocument = Boolean(reference.containerId);

            return (
              <MiniAppTableRow key={`${reference.localId}:${reference.slotId}`}>
                <MiniAppTableCell title={reference.localId}>
                  {reference.documentTitle ?? compactId(reference.localId)}
                </MiniAppTableCell>
                <MiniAppTableCell title={reference.containerId ?? undefined}>
                  {containerName ?? compactId(reference.containerId)}
                </MiniAppTableCell>
                <MiniAppTableCell>
                  {getExplorerDocumentInfoAttachmentKindLabel(
                    reference.attachmentKind,
                  )}
                </MiniAppTableCell>
                <MiniAppTableCell title={reference.slotId}>
                  {compactId(reference.slotId)}
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <div className="explorer-blob-reference-actions">
                    <MiniAppTableActionButton
                      disabled={!canOpenDocument}
                      onClick={() => {
                        if (reference.containerId) {
                          params.selectDocumentProjection(
                            reference.localId,
                            reference.containerId,
                          );
                        }
                      }}
                    >
                      {EXPLORER_LABELS.blobBrowserOpenDocumentAction}
                    </MiniAppTableActionButton>
                    <MiniAppTableActionButton
                      disabled={!canOpenDocument}
                      onClick={() => {
                        if (reference.containerId) {
                          params.openDocumentInfoRoute(
                            reference.localId,
                            reference.containerId,
                          );
                        }
                      }}
                    >
                      {EXPLORER_LABELS.blobBrowserDocumentInfoAction}
                    </MiniAppTableActionButton>
                  </div>
                </MiniAppTableCell>
              </MiniAppTableRow>
            );
          })}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppInfoSection>
  );
}

function BlobDetail(params: {
  blob: BlobInfo | null;
  blobStore: BlobStore;
  containerNamesById: ReadonlyMap<string, string>;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
}) {
  const preview = useBlobPreview({
    blob: params.blob,
    blobStore: params.blobStore,
  });

  if (!params.blob) {
    return (
      <MiniAppPanel className="explorer-blob-browser-detail">
        <MiniAppStatus>{EXPLORER_LABELS.blobBrowserNoSelection}</MiniAppStatus>
      </MiniAppPanel>
    );
  }

  return (
    <MiniAppPanel className="explorer-blob-browser-detail">
      <BlobMetadataSection blob={params.blob} preview={preview} />
      <BlobPreviewSection blob={params.blob} preview={preview} />
      <BlobReferencesSection
        blob={params.blob}
        containerNamesById={params.containerNamesById}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
        selectDocumentProjection={params.selectDocumentProjection}
      />
    </MiniAppPanel>
  );
}

export function ExplorerBlobBrowserPanel(params: {
  blobStore: BlobStore;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  route: BlobBrowserRoute;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
}) {
  const [query, setQuery] = useState(() => getBlobRouteQuery(params.route));
  const [activeBlobKey, setActiveBlobKey] = useState<string | null>(null);
  const routeQuery = getBlobRouteQuery(params.route);
  const blobInfo = useBlobInfoList({
    loadBlobInfo: params.loadBlobInfo,
    query,
  });
  const activeBlob = getSelectedBlob({
    activeBlobKey,
    route: params.route,
    rows: blobInfo.rows,
  });
  const containerNamesById = useMemo(
    () => getContainerNameById(params.nodes),
    [params.nodes],
  );

  useEffect(() => {
    setActiveBlobKey(null);
    setQuery(routeQuery);
  }, [routeQuery]);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--blob-browser"
      key={`${params.route.blobId ?? ""}:${params.route.storageKey ?? ""}`}
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.blobBrowserTitle}</strong>
          <span>
            {activeBlob
              ? compactId(activeBlob.blobId ?? activeBlob.storageKey)
              : EXPLORER_LABELS.blobBrowserNoSelection}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={params.onBackToSelectionRoute}>
            {EXPLORER_LABELS.blobBrowserBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          onChange={(event) => {
            setActiveBlobKey(null);
            setQuery(event.currentTarget.value);
          }}
          placeholder={EXPLORER_LABELS.blobBrowserSearchPlaceholder}
          value={query}
        />
      </MiniAppToolbar>
      <div className="explorer-blob-browser-grid">
        <BlobInfoTable
          activeBlob={activeBlob}
          error={blobInfo.error}
          isLoading={blobInfo.isLoading}
          onSelectBlob={(blob) => setActiveBlobKey(blob.key)}
          rows={blobInfo.rows}
          totalCount={blobInfo.totalCount}
        />
        <BlobDetail
          blob={activeBlob}
          blobStore={params.blobStore}
          containerNamesById={containerNamesById}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          selectDocumentProjection={params.selectDocumentProjection}
        />
      </div>
    </MiniAppPanel>
  );
}
