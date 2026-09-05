import type { Icon } from "@phosphor-icons/react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { type RefObject, useEffect, useRef } from "react";
import { classNames } from "../../shared/classNames";
import { Menu, type MenuPosition } from "../../shared/Menu";
import { MiniAppButton } from "./MiniAppButton";
import {
  getOptionElementId,
  type MiniAppSelectMenuController,
  type MiniAppSelectMenuOption,
  useMiniAppSelectMenuController,
} from "./MiniAppSelectMenuState";
import "./MiniAppSelectMenu.css";

interface MiniAppSelectMenuProps {
  ariaLabel: string;
  className?: string | undefined;
  disabled?: boolean;
  footerAction?:
    | {
        disabled?: boolean;
        icon: Icon;
        label: string;
        onSelect: () => void;
      }
    | undefined;
  onChange: (value: string) => void;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  placeholder?: string;
  portaled?: boolean;
  selectRef?: RefObject<HTMLButtonElement | null>;
  value: string;
}

function MiniAppSelectMenuFooterAction(props: {
  action: NonNullable<MiniAppSelectMenuProps["footerAction"]>;
  close: () => void;
}) {
  const ActionIcon = props.action.icon;

  return (
    <button
      className="mini-app-select-menu-option"
      disabled={props.action.disabled}
      onClick={() => {
        props.action.onSelect();
        props.close();
      }}
      type="button"
    >
      <ActionIcon
        aria-hidden="true"
        className="mini-app-select-menu-icon"
        focusable="false"
        size={16}
        weight="regular"
      />
      <span className="mini-app-select-menu-label">{props.action.label}</span>
    </button>
  );
}

function MiniAppSelectMenuTrigger(props: {
  ariaLabel: string;
  controller: MiniAppSelectMenuController;
  disabled: boolean;
  hasFooter: boolean;
  optionCount: number;
  placeholder: string | undefined;
  selectRef: RefObject<HTMLButtonElement | null>;
  stopMouseDownPropagation: boolean;
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
      onMouseDown={(event) => {
        if (props.stopMouseDownPropagation) {
          event.stopPropagation();
        }
      }}
      ref={props.selectRef}
      role="combobox"
    >
      <span className="mini-app-select-menu-value">
        {controller.selectedOption?.icon}
        <span className="mini-app-select-menu-label">
          {controller.selectedOption?.triggerLabel ??
            controller.selectedOption?.label ??
            props.placeholder}
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
      data-value={params.option.id}
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
      {params.option.secondaryLabel ? (
        <span className="mini-app-select-menu-option-secondary">
          {params.option.secondaryLabel}
        </span>
      ) : null}
    </button>
  );
}

function MiniAppSelectMenuPopover(props: {
  controller: MiniAppSelectMenuController;
  footerAction: MiniAppSelectMenuProps["footerAction"];
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  portaled: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  value: string;
}) {
  const { controller } = props;

  return (
    <div
      ref={props.popoverRef}
      className={classNames(
        "mini-app-select-menu-popover",
        props.portaled && "mini-app-select-menu-popover--portal",
      )}
    >
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
      {props.footerAction ? (
        <div className="mini-app-select-menu-footer">
          <MiniAppSelectMenuFooterAction
            action={props.footerAction}
            close={controller.close}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A single-select dropdown styled as a custom combobox: a `MiniAppButton`
 * trigger opening an absolutely-positioned listbox of options, with keyboard
 * navigation. Optionally renders a footer action below the options.
 */
export function MiniAppSelectMenu(props: MiniAppSelectMenuProps) {
  const internalRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const selectRef = props.selectRef ?? internalRef;
  const disabled = props.disabled ?? false;
  const hasFooter = Boolean(props.footerAction);
  const portaled = props.portaled ?? false;
  const controller = useMiniAppSelectMenuController({
    disabled,
    hasFooter,
    onChange: props.onChange,
    options: props.options,
    portalRef,
    selectRef,
    value: props.value,
  });
  const portalPosition: MenuPosition | null = (() => {
    if (!controller.open || !portaled || !selectRef.current) {
      return null;
    }

    const rect = selectRef.current.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  })();
  const popover = controller.open ? (
    <MiniAppSelectMenuPopover
      controller={controller}
      footerAction={props.footerAction}
      options={props.options}
      portaled={portaled}
      popoverRef={portalRef}
      value={props.value}
    />
  ) : null;

  return (
    <div
      className={classNames("mini-app-select-menu", props.className)}
      ref={controller.rootRef}
    >
      <MiniAppSelectMenuTrigger
        ariaLabel={props.ariaLabel}
        controller={controller}
        disabled={disabled}
        hasFooter={hasFooter}
        optionCount={props.options.length}
        placeholder={props.placeholder}
        selectRef={selectRef}
        stopMouseDownPropagation={portaled}
      />
      {portalPosition ? (
        <Menu
          direction="down"
          keyboardNavigation={false}
          onClose={controller.close}
          position={portalPosition}
        >
          {popover}
        </Menu>
      ) : (
        popover
      )}
    </div>
  );
}
