import type { MouseEventHandler } from "react";
import type { WindowingIcon } from "../icons/windowingIcon";

export interface MenuItemProps {
  /** Any icon component, such as a Phosphor or Lucide icon. */
  icon?: WindowingIcon | undefined;
  label: string;
  disabled?: boolean | undefined;
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
        />
      )}
      <span className="menu-item-label">{label}</span>
    </button>
  );
}
