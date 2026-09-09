import type { Icon } from "@phosphor-icons/react";
import type { DiagnosticAction } from "../../host/AppDiagnostics";
import { useDiagnosticBreadcrumb } from "../../providers/logging/useDiagnosticBreadcrumb";

export function MenuItem({
  icon: IconComponent,
  label,
  disabled,
  onClick,
  diagnosticAction,
}: {
  icon?: Icon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  diagnosticAction?: DiagnosticAction | undefined;
}) {
  const breadcrumb = useDiagnosticBreadcrumb();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (diagnosticAction) breadcrumb(diagnosticAction);
        onClick();
      }}
    >
      {IconComponent && (
        <IconComponent
          aria-hidden="true"
          className="menu-item-icon"
          focusable="false"
          size={16}
          weight="regular"
        />
      )}
      <span className="menu-item-label">{label}</span>
    </button>
  );
}
