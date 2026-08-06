import { type RefObject, useMemo } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import type { MoveTargetOption } from "../model/targetOptions";
import { ExplorerContainerIcon } from "../shared/ExplorerContainerIcon";

interface ExplorerTargetSelectProps {
  ariaLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<MoveTargetOption>;
  selectRef: RefObject<HTMLButtonElement | null>;
  value: string;
}

export function ExplorerTargetSelect(props: ExplorerTargetSelectProps) {
  const options = useMemo(
    () =>
      props.options.map((option) => ({
        icon: (
          <ExplorerContainerIcon
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
