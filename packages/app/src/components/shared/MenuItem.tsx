import type { Icon } from "@phosphor-icons/react";
import type { MouseEventHandler } from "react";

export interface MenuItemProps {
  icon?: Icon;
  label: string;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

export function MenuItem({
  icon: IconComponent,
  label,
  disabled,
  onClick,
}: MenuItemProps) {
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
