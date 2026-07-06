import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { classNames } from "../../shared/classNames";
import { MiniAppButton } from "./MiniAppButton";
import {
  getOptionElementId,
  type MiniAppSelectMenuController,
  type MiniAppSelectMenuOption,
  useMiniAppSelectMenuController,
} from "./MiniAppSelectMenuState";
import "./MiniAppSelectMenu.css";

export type {
  MiniAppSelectMenuController,
  MiniAppSelectMenuOption,
} from "./MiniAppSelectMenuState";

export interface MiniAppSelectMenuProps {
  ariaLabel: string;
  disabled?: boolean;
  /**
   * Rendered at the bottom of the open dropdown, below the options and outside
   * the listbox — a spot for actions such as "New…". `close` dismisses the menu.
   */
  footer?: (helpers: { close: () => void }) => ReactNode;
  onChange: (value: string) => void;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  placeholder?: string;
  selectRef?: RefObject<HTMLButtonElement | null>;
  value: string;
}

function MiniAppSelectMenuTrigger(props: {
  ariaLabel: string;
  controller: MiniAppSelectMenuController;
  disabled: boolean;
  hasFooter: boolean;
  optionCount: number;
  placeholder: string | undefined;
  selectRef: RefObject<HTMLButtonElement | null>;
}) {
  const { controller } = props;

  return (
    <MiniAppButton
      aria-activedescendant={controller.activeDescendant}
      aria-controls={controller.open ? controller.listboxId : undefined}
      aria-expanded={controller.open}
      aria-haspopup="listbox"
      aria-label={props.ariaLabel}
      className="mini-app-select-menu-trigger"
      disabled={props.disabled || (props.optionCount === 0 && !props.hasFooter)}
      onClick={() => {
        if (controller.open) {
          controller.close();
          return;
        }

        controller.openList();
      }}
      onKeyDown={controller.onKeyDown}
      ref={props.selectRef}
      role="combobox"
    >
      <span className="mini-app-select-menu-value">
        {controller.selectedOption?.icon}
        <span className="mini-app-select-menu-label">
          {controller.selectedOption?.label ?? props.placeholder}
        </span>
      </span>
      <CaretDownIcon
        aria-hidden="true"
        className={classNames(
          "mini-app-select-menu-caret",
          controller.open && "mini-app-select-menu-caret--open",
        )}
        focusable="false"
        size={14}
        weight="regular"
      />
    </MiniAppButton>
  );
}

function MiniAppSelectMenuOptionButton(params: {
  highlighted: boolean;
  id: string;
  onHighlight: () => void;
  onSelect: () => void;
  option: MiniAppSelectMenuOption;
  selected: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (params.highlighted) {
      ref.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [params.highlighted]);

  return (
    <button
      ref={ref}
      aria-selected={params.selected}
      className="mini-app-select-menu-option"
      data-highlighted={params.highlighted || undefined}
      id={params.id}
      onClick={params.onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={params.onHighlight}
      role="option"
      tabIndex={-1}
      type="button"
    >
      {params.option.icon}
      <span className="mini-app-select-menu-label">{params.option.label}</span>
    </button>
  );
}

function MiniAppSelectMenuPopover(props: {
  controller: MiniAppSelectMenuController;
  footer: MiniAppSelectMenuProps["footer"];
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  value: string;
}) {
  const { controller } = props;

  return (
    <div className="mini-app-select-menu-popover">
      <div
        className="mini-app-select-menu-list"
        id={controller.listboxId}
        role="listbox"
      >
        {props.options.map((option, index) => (
          <MiniAppSelectMenuOptionButton
            highlighted={option.id === controller.highlightedId}
            id={getOptionElementId(controller.listboxId, index)}
            key={option.id}
            onHighlight={() => controller.setHighlightedId(option.id)}
            onSelect={() => controller.selectOption(option)}
            option={option}
            selected={option.id === props.value}
          />
        ))}
      </div>
      {props.footer ? (
        <div className="mini-app-select-menu-footer">
          {props.footer({ close: controller.close })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-select dropdown styled as a custom combobox: a `MiniAppButton`
 * trigger opening an absolutely-positioned listbox of options, with keyboard
 * navigation. Optionally renders a `footer` action below the options. Shared by
 * Explorer's move dialog and the org-manager organization switcher.
 */
export function MiniAppSelectMenu(props: MiniAppSelectMenuProps) {
  const internalRef = useRef<HTMLButtonElement>(null);
  const selectRef = props.selectRef ?? internalRef;
  const disabled = props.disabled ?? false;
  const hasFooter = Boolean(props.footer);
  const controller = useMiniAppSelectMenuController({
    disabled,
    hasFooter,
    onChange: props.onChange,
    options: props.options,
    selectRef,
    value: props.value,
  });

  return (
    <div className="mini-app-select-menu" ref={controller.rootRef}>
      <MiniAppSelectMenuTrigger
        ariaLabel={props.ariaLabel}
        controller={controller}
        disabled={disabled}
        hasFooter={hasFooter}
        optionCount={props.options.length}
        placeholder={props.placeholder}
        selectRef={selectRef}
      />
      {controller.open ? (
        <MiniAppSelectMenuPopover
          controller={controller}
          footer={props.footer}
          options={props.options}
          value={props.value}
        />
      ) : null}
    </div>
  );
}
