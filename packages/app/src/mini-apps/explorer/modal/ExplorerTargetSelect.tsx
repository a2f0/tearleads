import { type RefObject, useMemo } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import { getExplorerContainerIcon } from "../explorerContainerIcons";
import type { MoveTargetOption } from "../targetOptions";

export interface ExplorerTargetSelectProps {
  ariaLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<MoveTargetOption>;
  selectRef: RefObject<HTMLButtonElement | null>;
  value: string;
}

function ExplorerTargetOptionIcon(params: {
  className: string;
  icon: string | null | undefined;
}) {
  const icon = getExplorerContainerIcon({
    icon: params.icon,
    isOpen: false,
  });
  const Icon = icon.Component;

  return (
    <Icon
      aria-hidden="true"
      className={params.className}
      data-container-icon={icon.containerIcon}
      data-icon={icon.name}
      focusable="false"
      size={16}
      weight="regular"
    />
  );
}

export function ExplorerTargetSelect(props: ExplorerTargetSelectProps) {
  const options = useMemo(
    () =>
      props.options.map((option) => ({
        icon: (
          <ExplorerTargetOptionIcon
            className="mini-app-select-menu-icon"
            icon={option.icon}
          />
        ),
        id: option.id,
        label: option.label,
      })),
    [props.options],
  );

  return (
    <MiniAppSelectMenu
      ariaLabel={props.ariaLabel}
      disabled={props.disabled}
      onChange={props.onChange}
      options={options}
      placeholder="Choose destination"
      selectRef={props.selectRef}
      value={props.value}
    />
  );
}
