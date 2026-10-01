import { MenuItem, type MenuItemProps } from "@tearleads/windowing";
import type { DiagnosticAction } from "../../host/AppDiagnostics";
import { useDiagnosticBreadcrumb } from "../../providers/logging/useDiagnosticBreadcrumb";

// A menu item that records its diagnostic action as an activity breadcrumb
// before running its click handler. MenuItem itself stays diagnostics-free so
// the window chrome can use it without the app's logging providers.
export function DiagnosticMenuItem({
  diagnosticAction,
  onClick,
  ...props
}: MenuItemProps & { diagnosticAction: DiagnosticAction }) {
  const breadcrumb = useDiagnosticBreadcrumb();
  return (
    <MenuItem
      {...props}
      onClick={(event) => {
        breadcrumb(diagnosticAction);
        onClick(event);
      }}
    />
  );
}
