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
      {IconComponent && <IconComponent aria-hidden size={16} />}
      {label}
    </button>
  );
}
