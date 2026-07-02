import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { classNames } from "../../../components/shared/classNames";
import { MiniAppButton } from "../../../components/shared/MiniAppLayout";
import { getExplorerContainerIcon } from "../explorerContainerIcons";
import type { MoveTargetOption } from "../targetOptions";
import {
  type ExplorerTargetSelectController,
  type ExplorerTargetSelectProps,
  getOptionElementId,
  useExplorerTargetSelectController,
} from "./ExplorerTargetSelectState";

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

function ExplorerTargetSelectTrigger(
  props: Pick<
    ExplorerTargetSelectController,
    | "activeDescendant"
    | "close"
    | "listboxId"
    | "onKeyDown"
    | "open"
    | "openList"
    | "selectedOption"
  > &
    Pick<
      ExplorerTargetSelectProps,
      "ariaLabel" | "disabled" | "options" | "selectRef"
    >,
) {
  return (
    <MiniAppButton
      aria-activedescendant={props.activeDescendant}
      aria-controls={props.open ? props.listboxId : undefined}
      aria-expanded={props.open}
      aria-haspopup="listbox"
      aria-label={props.ariaLabel}
      className="explorer-target-select-trigger"
      disabled={props.disabled || props.options.length === 0}
      onClick={() => {
        if (props.open) {
          props.close();
          return;
        }

        props.openList();
      }}
      onKeyDown={props.onKeyDown}
      ref={props.selectRef}
      role="combobox"
    >
      <span className="explorer-target-select-value">
        <ExplorerTargetOptionIcon
          className="explorer-target-select-icon"
          icon={props.selectedOption?.icon}
        />
        <span className="explorer-target-select-label">
          {props.selectedOption?.label ?? "Choose destination"}
        </span>
      </span>
      <CaretDownIcon
        aria-hidden="true"
        className={classNames(
          "explorer-target-select-caret",
          props.open && "explorer-target-select-caret--open",
        )}
        focusable="false"
        size={14}
        weight="regular"
      />
    </MiniAppButton>
  );
}

function ExplorerTargetSelectOption(params: {
  highlighted: boolean;
  id: string;
  onHighlight: () => void;
  onSelect: () => void;
  option: MoveTargetOption;
  selected: boolean;
}) {
  return (
    <button
      aria-selected={params.selected}
      className="explorer-target-select-option"
      data-highlighted={params.highlighted || undefined}
      id={params.id}
      onClick={params.onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={params.onHighlight}
      role="option"
      type="button"
    >
      <ExplorerTargetOptionIcon
        className="explorer-target-select-icon"
        icon={params.option.icon}
      />
      <span className="explorer-target-select-label">
        {params.option.label}
      </span>
    </button>
  );
}

function ExplorerTargetSelectList(
  props: Pick<
    ExplorerTargetSelectController,
    "highlightedId" | "listboxId" | "selectOption" | "setHighlightedId"
  > &
    Pick<ExplorerTargetSelectProps, "options" | "value">,
) {
  return (
    <div
      className="explorer-target-select-list"
      id={props.listboxId}
      role="listbox"
    >
      {props.options.map((option, index) => (
        <ExplorerTargetSelectOption
          highlighted={option.id === props.highlightedId}
          id={getOptionElementId(props.listboxId, index)}
          key={option.id}
          onHighlight={() => props.setHighlightedId(option.id)}
          onSelect={() => props.selectOption(option)}
          option={option}
          selected={option.id === props.value}
        />
      ))}
    </div>
  );
}

export function ExplorerTargetSelect(props: ExplorerTargetSelectProps) {
  const controller = useExplorerTargetSelectController(props);

  return (
    <div className="explorer-target-select" ref={controller.rootRef}>
      <ExplorerTargetSelectTrigger
        activeDescendant={controller.activeDescendant}
        ariaLabel={props.ariaLabel}
        close={controller.close}
        disabled={props.disabled}
        listboxId={controller.listboxId}
        onKeyDown={controller.onKeyDown}
        open={controller.open}
        openList={controller.openList}
        options={props.options}
        selectRef={props.selectRef}
        selectedOption={controller.selectedOption}
      />
      {controller.open ? (
        <ExplorerTargetSelectList
          highlightedId={controller.highlightedId}
          listboxId={controller.listboxId}
          options={props.options}
          selectOption={controller.selectOption}
          setHighlightedId={controller.setHighlightedId}
          value={props.value}
        />
      ) : null}
    </div>
  );
}
