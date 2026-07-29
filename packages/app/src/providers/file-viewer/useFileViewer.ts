import { useMemo } from "react";
import type { FileViewer } from "../../host/FileViewer";
import { useAppHostConfig } from "../host/AppHostConfigProvider";

/** Builds the optional native viewer once for the current platform factory. */
export function useFileViewer(): FileViewer | null {
  const { createFileViewer } = useAppHostConfig();
  return useMemo(() => createFileViewer?.() ?? null, [createFileViewer]);
}
