import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MoveTargetOption } from "../targetOptions";

export interface ExplorerTargetSelectProps {
  ariaLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<MoveTargetOption>;
  selectRef: RefObject<HTMLButtonElement | null>;
  value: string;
}

export interface ExplorerTargetSelectController {
  activeDescendant: string | undefined;
  close: () => void;
  highlightedId: string;
  listboxId: string;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  open: boolean;
  openList: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
  selectOption: (option: MoveTargetOption) => void;
  selectedOption: MoveTargetOption | undefined;
  setHighlightedId: (value: string) => void;
}

interface ExplorerTargetSelectKeyControls {
  close: () => void;
  commitSelection: () => void;
  highlightEdge: (edge: "end" | "start") => void;
  moveHighlight: (direction: -1 | 1) => void;
  open: boolean;
  openList: () => void;
  options: ReadonlyArray<MoveTargetOption>;
}

function getOptionIndex(
  options: ReadonlyArray<MoveTargetOption>,
  optionId: string,
): number {
  return options.findIndex((option) => option.id === optionId);
}

function getNextOptionIndex(params: {
  currentId: string;
  direction: -1 | 1;
  options: ReadonlyArray<MoveTargetOption>;
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

function handleTargetSelectKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  controls: ExplorerTargetSelectKeyControls,
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
    return;
  }

  if (event.key === "Tab") {
    controls.close();
  }
}

function useCloseOnOutsideMouseDown(params: {
  close: () => void;
  open: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const { close, open, rootRef } = params;
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) {
        close();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [close, open, rootRef]);
}

function useExplorerTargetSelectKeyboard(
  controls: ExplorerTargetSelectKeyControls,
) {
  const {
    close,
    commitSelection,
    highlightEdge,
    moveHighlight,
    open,
    openList,
    options,
  } = controls;

  return useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) =>
      handleTargetSelectKeyDown(event, {
        close,
        commitSelection,
        highlightEdge,
        moveHighlight,
        open,
        openList,
        options,
      }),
    [
      close,
      commitSelection,
      highlightEdge,
      moveHighlight,
      open,
      openList,
      options,
    ],
  );
}

function useSyncTargetSelectHighlight(params: {
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

export function useExplorerTargetSelectController(
  params: ExplorerTargetSelectProps,
): ExplorerTargetSelectController {
  const { disabled, onChange, options, selectRef, value } = params;
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

  const close = useCallback(() => setOpen(false), []);
  const openList = useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }

    setHighlightedId(selectedOption?.id ?? options[0]?.id ?? "");
    setOpen(true);
  }, [disabled, options, selectedOption?.id]);

  const selectOption = useCallback(
    (option: MoveTargetOption) => {
      onChange(option.id);
      setHighlightedId(option.id);
      setOpen(false);
      selectRef.current?.focus();
    },
    [onChange, selectRef],
  );

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
    [highlightedId, options, value],
  );

  const highlightEdge = useCallback(
    (edge: "end" | "start") => {
      setHighlightedId(
        edge === "start" ? (options[0]?.id ?? "") : (options.at(-1)?.id ?? ""),
      );
      setOpen(true);
    },
    [options],
  );

  const commitSelection = useCallback(() => {
    const option =
      options[getOptionIndex(options, highlightedId)] ?? selectedOption;
    if (option) {
      selectOption(option);
    }
  }, [highlightedId, options, selectOption, selectedOption]);

  const onKeyDown = useExplorerTargetSelectKeyboard({
    close,
    commitSelection,
    highlightEdge,
    moveHighlight,
    open,
    openList,
    options,
  });

  useCloseOnOutsideMouseDown({ close, open, rootRef });
  useSyncTargetSelectHighlight({ open, setHighlightedId, value });

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
