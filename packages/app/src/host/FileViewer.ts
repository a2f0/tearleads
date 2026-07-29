/** Bytes and metadata for a file the platform should present to the user. */
export interface ViewFileRequest {
  readonly data: Uint8Array<ArrayBuffer>;
  readonly fileName: string;
  readonly mimeType?: string | null | undefined;
}

/**
 * Native file-presentation capability for shells whose WebView cannot render a
 * format itself. The browser shell omits it and uses its built-in renderer.
 */
export interface FileViewer {
  viewFile(request: ViewFileRequest): Promise<void>;
}

export type CreateFileViewerFn = () => FileViewer;
