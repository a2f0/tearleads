import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortKey,
  BlobStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import {
  getMiniAppVirtualWindowRange,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
} from "../../../components/shared/MiniAppVirtual";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";
import type { ExplorerRoute } from "../routes";

export const BLOB_BROWSER_ROW_HEIGHT =
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT;
const BLOB_TEXT_PREVIEW_LIMIT = 64 * 1024;

export type BlobBrowserRoute = Extract<ExplorerRoute, { view: "blob-browser" }>;

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

interface BlobInfoListState {
  error: string | null;
  isLoading: boolean;
  offset: number;
  rows: ReadonlyArray<BlobInfo>;
  totalCount: number;
}

export function getBlobRouteQuery(route: BlobBrowserRoute): string {
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

export function useBlobInfoList(params: {
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

export function isImageMimeType(mimeType: string | null): boolean {
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

export function getSelectedBlob(params: {
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

  return (
    params.rows.find((blob) => matchesRouteTarget(blob, params.route)) ??
    params.rows[0] ??
    null
  );
}
