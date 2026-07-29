import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react";
import type { FileViewer } from "../../host/FileViewer";
import { useAppHostConfig } from "../host/AppHostConfigProvider";

const FileViewerContext = createContext<FileViewer | null>(null);

/** Owns the optional native viewer once for the lifetime of the app runtime. */
export function FileViewerProvider({ children }: PropsWithChildren) {
  const { createFileViewer } = useAppHostConfig();
  const initializedRef = useRef(false);
  const viewerRef = useRef<FileViewer | null>(null);
  if (!initializedRef.current) {
    viewerRef.current = createFileViewer?.() ?? null;
    initializedRef.current = true;
  }

  return (
    <FileViewerContext.Provider value={viewerRef.current}>
      {children}
    </FileViewerContext.Provider>
  );
}

/** Returns the app runtime's shared optional native viewer. */
export function useFileViewer(): FileViewer | null {
  return useContext(FileViewerContext);
}
