import { useEffect, useRef } from "react";
import type { DiagnosticAction } from "../../../host/AppDiagnostics";
import { useDiagnosticBreadcrumb } from "../../../providers/logging/useDiagnosticBreadcrumb";

export function useExplorerViewBreadcrumb(input: {
  containerId: string | null;
  documentSelected: boolean;
  rootSelected: boolean;
  trashContainerId: string | null;
}) {
  const breadcrumb = useDiagnosticBreadcrumb("explorer");
  const action: DiagnosticAction | null = input.documentSelected
    ? "document-view"
    : input.containerId === null
      ? null
      : input.rootSelected
        ? "root-view"
        : input.containerId === input.trashContainerId
          ? "trash-view"
          : "folder-view";
  const previous = useRef<DiagnosticAction | null>(null);
  useEffect(() => {
    if (action && action !== previous.current) breadcrumb(action);
    previous.current = action;
  }, [action, breadcrumb]);
}
