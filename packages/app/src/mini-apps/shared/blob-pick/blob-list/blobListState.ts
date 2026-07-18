import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  useMiniAppVirtualWindow,
} from "../../../../components/mini-app/virtual/MiniAppVirtual";
import {
  isAutomaticBlobPreviewAllowed,
  isImageDocumentAttachmentBlob,
} from "../../../../document-types/shared/documentAttachmentUtils";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

export const BLOB_BROWSER_ROW_HEIGHT =
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT;
const BLOB_TEXT_PREVIEW_LIMIT = 64 * 1024;

// The subset of a host route the blob list reads: the deep-link target (blob id
// or storage key) that seeds the initial search/selection. Standalone so the
// shared surface stays decoupled from any mini-app's route union; hosts pass a
// structurally-compatible object (e.g. the Explorer's blob-browser route, or an
// empty target in pick mode).
export interface BlobBrowserRoute {
  blobId: string | null;
  storageKey: string | null;
}

export type BlobPreviewState =
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

export interface BlobInfoListState {
  error: string | null;
  isLoading: boolean;
  offset: number;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
}

// NUL separator: a query can never contain it, so the query and sort fields
// can never collide when building the virtual-window reset key.
const BLOB_BROWSER_RESET_KEY_SEPARATOR = "\u0000";

function getBlobRouteQuery(route: BlobBrowserRoute): string {
  return route.blobId ?? route.storageKey ?? "";
}

export function getBlobChangedAt(blob: BlobInfo): string | null {
  return blob.updatedAt ?? blob.createdAt;
}

export function getBlobInfoWindowRange(params: {
  scrollTop: number;
  viewportHeight: number;
}): { limit: number; offset: number } {
  return getMiniAppVirtualWindowRange({
    ...params,
    rowHeight: BLOB_BROWSER_ROW_HEIGHT,
  });
}

export function getNextBlobInfoSort(
  currentSort: BlobInfoSort,
  key: BlobInfoSortKey,
): BlobInfoSort {
  if (currentSort.key === key) {
    return {
      direction: currentSort.direction === "asc" ? "desc" : "asc",
      key,
    };
  }

  return {
    direction: key === "mimeType" ? "asc" : "desc",
    key,
  };
}

export function getContainerNameById(
  nodes: ReadonlyArray<ContainerNode>,
): ReadonlyMap<string, string> {
  return new Map(nodes.map((node) => [node.id, node.name]));
}

function useBlobInfoList(params: {
  limit: number;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  offset: number;
  query: string;
  sort: BlobInfoSort;
}) {
  const { limit, loadBlobInfo, offset, query, sort } = params;
  const [state, setState] = useState<BlobInfoListState>({
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, error: null, isLoading: true }));

    void loadBlobInfo({
      limit,
      offset,
      query,
      sort,
    })
      .then((result) => {
        if (!cancelled) {
          setState({
            error: null,
            isLoading: false,
            offset,
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
            offset,
            rows: [],
            totalCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [limit, loadBlobInfo, offset, query, sort]);

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

function canCreateObjectUrl(): boolean {
  return typeof URL === "function" && typeof URL.createObjectURL === "function";
}

function decodePreviewText(bytes: Uint8Array<ArrayBuffer>): {
  text: string;
  truncated: boolean;
} {
  const truncated = bytes.byteLength > BLOB_TEXT_PREVIEW_LIMIT;
  // subarray returns a view rather than copying; we only read it to decode.
  const previewBytes = truncated
    ? bytes.subarray(0, BLOB_TEXT_PREVIEW_LIMIT)
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
  if (!isAutomaticBlobPreviewAllowed(input.blob)) {
    return {
      objectUrl: null,
      state: {
        byteLength: input.blob.byteLength,
        status: "ready",
        text: null,
        truncated: false,
        url: null,
      },
    };
  }

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

  try {
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
  } catch (error) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    throw error;
  }
}

export function useBlobPreview(params: {
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

// Read a small image blob into an object URL for a compact table thumbnail.
// Large, non-image, and non-browser blobs use the file-type icon instead.
export function useBlobThumbnailUrl(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): string | null {
  const { blobStore } = params;
  const isImage = isImageDocumentAttachmentBlob(params.blob);
  const isPreviewAllowed = isAutomaticBlobPreviewAllowed(params.blob);
  const { storageKey } = params.blob;
  const mimeType = params.blob.mimeType ?? "application/octet-stream";
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage || !isPreviewAllowed || !canCreateObjectUrl()) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const bytes = await blobStore.readBytes(storageKey);
        if (cancelled || !bytes) {
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        setUrl(objectUrl);
      } catch {
        // A thumbnail is best-effort; a failed read just falls back to the icon.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setUrl(null);
    };
  }, [blobStore, isImage, isPreviewAllowed, mimeType, storageKey]);

  return url;
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
  activeBlob: BlobInfo | null;
  route: BlobBrowserRoute;
  rows: ReadonlyArray<BlobInfo>;
}): BlobInfo | null {
  if (params.activeBlob) {
    return (
      params.rows.find((blob) => blob.key === params.activeBlob?.key) ??
      params.activeBlob
    );
  }

  // The list is the default screen; only open the detail screen when the route
  // deep-links to a specific blob. Do not fall back to the first row, which
  // would skip the list entirely.
  return (
    params.rows.find((blob) => matchesRouteTarget(blob, params.route)) ?? null
  );
}

export function useBlobBrowserData(params: {
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  route: BlobBrowserRoute;
}) {
  const [query, setQuery] = useState(() => getBlobRouteQuery(params.route));
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [activeBlob, setActiveBlob] = useState<BlobInfo | null>(null);
  // Tracks whether the user dismissed the detail screen. Needed because a
  // route deep-link makes getSelectedBlob return a blob even when activeBlob is
  // null, so clearing activeBlob alone could not return to the list.
  const [isDetailDismissed, setIsDetailDismissed] = useState(false);
  const [sort, setSort] = useState<BlobInfoSort>({
    direction: "desc",
    key: "updated",
  });
  const routeQuery = getBlobRouteQuery(params.route);
  const resetKey = [debouncedQuery, sort.key, sort.direction].join(
    BLOB_BROWSER_RESET_KEY_SEPARATOR,
  );
  const { frameRef, limit, offset } = useMiniAppVirtualWindow({
    resetKey,
    rowHeight: BLOB_BROWSER_ROW_HEIGHT,
  });
  const blobInfo = useBlobInfoList({
    limit,
    loadBlobInfo: params.loadBlobInfo,
    offset,
    query: debouncedQuery,
    sort,
  });
  const isWindowPending = blobInfo.offset !== offset;
  const isResettingWindow = isWindowPending && offset === 0;
  const rows = isResettingWindow ? [] : blobInfo.rows;
  const rowOffset = isResettingWindow ? 0 : blobInfo.offset;
  const selectedBlob = isDetailDismissed
    ? null
    : getSelectedBlob({ activeBlob, route: params.route, rows });
  const isListDetail = activeBlob !== null && selectedBlob !== null;
  const handleSort = useCallback((key: BlobInfoSortKey) => {
    setActiveBlob(null);
    setSort((currentSort) => getNextBlobInfoSort(currentSort, key));
  }, []);
  const handleSelectBlob = useCallback((blob: BlobInfo) => {
    setActiveBlob(blob);
    setIsDetailDismissed(false);
  }, []);
  const handleBackToList = useCallback(() => {
    setActiveBlob(null);
    setIsDetailDismissed(true);
  }, []);
  const handleQueryChange = useCallback((value: string) => {
    setActiveBlob(null);
    setIsDetailDismissed(true);
    setQuery(value);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);

    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setActiveBlob(null);
    setIsDetailDismissed(false);
    setQuery(routeQuery);
    setDebouncedQuery(routeQuery);
  }, [routeQuery]);

  return {
    blobInfo,
    frameRef,
    handleBackToList,
    handleQueryChange,
    handleSelectBlob,
    handleSort,
    isListDetail,
    isWindowPending,
    query,
    rowOffset,
    rows,
    selectedBlob,
    sort,
  };
}
