interface DropdownMenuKeyboardArgs {
  event: React.KeyboardEvent<HTMLDivElement>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  focusedIndex: number;
  setFocusedIndex: (nextIndex: number) => void;
}

export function handleDropdownMenuKeyboard({
  event,
  menuRef,
  focusedIndex,
  setFocusedIndex
}: DropdownMenuKeyboardArgs): void {
  const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
    '[role="menuitem"]:not([disabled])'
  );
  if (!items || items.length === 0) {
    return;
  }

  const focusAt = (nextIndex: number) => {
    setFocusedIndex(nextIndex);
    items[nextIndex]?.focus();
  };

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusAt(focusedIndex < items.length - 1 ? focusedIndex + 1 : 0);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusAt(focusedIndex > 0 ? focusedIndex - 1 : items.length - 1);
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    focusAt(0);
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    focusAt(items.length - 1);
  }
}
