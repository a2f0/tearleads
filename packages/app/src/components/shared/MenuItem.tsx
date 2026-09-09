import type { Icon } from "@phosphor-icons/react";
import type { MouseEventHandler } from "react";
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
  onClick: MouseEventHandler<HTMLButtonElement>;
  diagnosticAction?: DiagnosticAction | undefined;
}) {
  const breadcrumb = useDiagnosticBreadcrumb();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        if (diagnosticAction) breadcrumb(diagnosticAction);
        onClick(event);
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
