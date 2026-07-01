import type { Icon } from "@phosphor-icons/react";

export function MenuItem({
  icon: IconComponent,
  label,
  disabled,
  onClick,
}: {
  icon?: Icon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
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
