import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface MiniAppSelectMenuOption {
  icon?: ReactNode;
  id: string;
  label: string;
  /** Extra option-only copy; omitted from the closed trigger. */
  secondaryLabel?: string | undefined;
  /** Visible trigger copy when it should differ from the option label. */
  triggerLabel?: string | undefined;
}

interface MiniAppSelectMenuControllerParams {
  disabled: boolean;
  /**
   * Whether the menu has a footer action. When true, the trigger stays openable
   * even with no options so the footer (e.g. a "New…" action) stays reachable.
   */
  hasFooter: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  portalRef: RefObject<HTMLDivElement | null>;
  selectRef: RefObject<HTMLButtonElement | null>;
  value: string;
}

export interface MiniAppSelectMenuController {
  activeDescendant: string | undefined;
  close: () => void;
  highlightedId: string;
  listboxId: string;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  open: boolean;
  openList: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
  selectOption: (option: MiniAppSelectMenuOption) => void;
  selectedOption: MiniAppSelectMenuOption | undefined;
  setHighlightedId: (value: string) => void;
}

interface MiniAppSelectMenuKeyControls {
  close: () => void;
  commitSelection: () => void;
  highlightEdge: (edge: "end" | "start") => void;
  moveHighlight: (direction: -1 | 1) => void;
  open: boolean;
  openList: () => void;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
}

function getOptionIndex(
  options: ReadonlyArray<MiniAppSelectMenuOption>,
  optionId: string,
): number {
  return options.findIndex((option) => option.id === optionId);
}

function getNextOptionIndex(params: {
  currentId: string;
  direction: -1 | 1;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
}) {
  const { currentId, direction, options } = params;
  if (options.length === 0) {
    return -1;
  }

  const currentIndex = getOptionIndex(options, currentId);
  if (currentIndex < 0) {
    return direction > 0 ? 0 : options.length - 1;
  }

  return (currentIndex + direction + options.length) % options.length;
}

export function getOptionElementId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function runKeyboardAction(
  event: KeyboardEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.preventDefault();
  action();
}

function handleSelectMenuKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  controls: MiniAppSelectMenuKeyControls,
) {
  if (event.key === "ArrowDown") {
    runKeyboardAction(event, () => controls.moveHighlight(1));
    return;
  }

  if (event.key === "ArrowUp") {
    runKeyboardAction(event, () => controls.moveHighlight(-1));
    return;
  }

  if (event.key === "Home" && controls.options.length > 0) {
    runKeyboardAction(event, () => controls.highlightEdge("start"));
    return;
  }

  if (event.key === "End" && controls.options.length > 0) {
    runKeyboardAction(event, () => controls.highlightEdge("end"));
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    runKeyboardAction(event, () => {
      if (controls.open) {
        controls.commitSelection();
      } else {
        controls.openList();
      }
    });
    return;
  }

  if (event.key === "Escape" && controls.open) {
    runKeyboardAction(event, controls.close);
  }

  // Tab is intentionally left to its default behaviour: it moves focus to the
  // next control (e.g. a footer action inside the open menu). The menu closes
  // via the root's focus-out handler once focus leaves the control entirely.
}

function useCloseOnOutsideMouseDown(params: {
  close: () => void;
  open: boolean;
  portalRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const { close, open, portalRef, rootRef } = params;
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (!rootRef.current?.contains(target) &&
          !portalRef.current?.contains(target))
      ) {
        close();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [close, open, portalRef, rootRef]);
}

function useCloseOnFocusOut(params: {
  close: () => void;
  open: boolean;
  portalRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const { close, open, portalRef, rootRef } = params;
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) {
      return;
    }

    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (
        !(next instanceof Node) ||
        (!root?.contains(next) && !portalRef.current?.contains(next))
      ) {
        close();
      }
    }

    root.addEventListener("focusout", handleFocusOut);
    return () => root.removeEventListener("focusout", handleFocusOut);
  }, [close, open, portalRef, rootRef]);
}

function useSyncSelectMenuHighlight(params: {
  open: boolean;
  setHighlightedId: (value: string) => void;
  value: string;
}) {
  const { open, setHighlightedId, value } = params;
  useEffect(() => {
    if (!open) {
      setHighlightedId(value);
    }
  }, [open, setHighlightedId, value]);
}

function useSelectMenuOpenActions(params: {
  disabled: boolean;
  hasFooter: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  selectRef: RefObject<HTMLButtonElement | null>;
  selectedOptionId: string | undefined;
  setHighlightedId: (value: string) => void;
  setOpen: (open: boolean) => void;
}) {
  const { onChange, options, selectRef, setHighlightedId, setOpen } = params;

  const close = useCallback(() => setOpen(false), [setOpen]);
  const openList = useCallback(() => {
    if (params.disabled || (options.length === 0 && !params.hasFooter)) {
      return;
    }

    setHighlightedId(params.selectedOptionId ?? options[0]?.id ?? "");
    setOpen(true);
  }, [
    params.disabled,
    params.hasFooter,
    params.selectedOptionId,
    options,
    setHighlightedId,
    setOpen,
  ]);

  const selectOption = useCallback(
    (option: MiniAppSelectMenuOption) => {
      onChange(option.id);
      setHighlightedId(option.id);
      setOpen(false);
      selectRef.current?.focus();
    },
    [onChange, selectRef, setHighlightedId, setOpen],
  );

  return { close, openList, selectOption };
}

function useSelectMenuHighlightActions(params: {
  highlightedId: string;
  options: ReadonlyArray<MiniAppSelectMenuOption>;
  selectOption: (option: MiniAppSelectMenuOption) => void;
  selectedOption: MiniAppSelectMenuOption | undefined;
  setHighlightedId: (value: string) => void;
  setOpen: (open: boolean) => void;
  value: string;
}) {
  const {
    highlightedId,
    options,
    selectOption,
    selectedOption,
    setHighlightedId,
    setOpen,
    value,
  } = params;

  const moveHighlight = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = getNextOptionIndex({
        currentId: highlightedId || value,
        direction,
        options,
      });
      if (nextIndex >= 0) {
        setHighlightedId(options[nextIndex]?.id ?? "");
      }
      setOpen(true);
    },
    [highlightedId, options, setHighlightedId, setOpen, value],
  );

  const highlightEdge = useCallback(
    (edge: "end" | "start") => {
      setHighlightedId(
        edge === "start" ? (options[0]?.id ?? "") : (options.at(-1)?.id ?? ""),
      );
      setOpen(true);
    },
    [options, setHighlightedId, setOpen],
  );

  const commitSelection = useCallback(() => {
    const option =
      options[getOptionIndex(options, highlightedId)] ?? selectedOption;
    if (option) {
      selectOption(option);
    }
  }, [highlightedId, options, selectOption, selectedOption]);

  return { commitSelection, highlightEdge, moveHighlight };
}

export function useMiniAppSelectMenuController(
  params: MiniAppSelectMenuControllerParams,
): MiniAppSelectMenuController {
  const {
    disabled,
    hasFooter,
    onChange,
    options,
    portalRef,
    selectRef,
    value,
  } = params;
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState(value);
  const selectedOption = useMemo(
    () => options.find((option) => option.id === value),
    [options, value],
  );
  const highlightedIndex = getOptionIndex(options, highlightedId);
  const activeDescendant =
    open && highlightedIndex >= 0
      ? getOptionElementId(listboxId, highlightedIndex)
      : undefined;

  const { close, openList, selectOption } = useSelectMenuOpenActions({
    disabled,
    hasFooter,
    onChange,
    options,
    selectRef,
    selectedOptionId: selectedOption?.id,
    setHighlightedId,
    setOpen,
  });

  const { commitSelection, highlightEdge, moveHighlight } =
    useSelectMenuHighlightActions({
      highlightedId,
      options,
      selectOption,
      selectedOption,
      setHighlightedId,
      setOpen,
      value,
    });

  const onKeyDown = useMemo(() => {
    const controls: MiniAppSelectMenuKeyControls = {
      close,
      commitSelection,
      highlightEdge,
      moveHighlight,
      open,
      openList,
      options,
    };
    return (event: KeyboardEvent<HTMLButtonElement>) =>
      handleSelectMenuKeyDown(event, controls);
  }, [
    close,
    commitSelection,
    highlightEdge,
    moveHighlight,
    open,
    openList,
    options,
  ]);

  useCloseOnOutsideMouseDown({ close, open, portalRef, rootRef });
  useCloseOnFocusOut({ close, open, portalRef, rootRef });
  useSyncSelectMenuHighlight({ open, setHighlightedId, value });

  return {
    activeDescendant,
    close,
    highlightedId,
    listboxId,
    onKeyDown,
    open,
    openList,
    rootRef,
    selectOption,
    selectedOption,
    setHighlightedId,
  };
}
