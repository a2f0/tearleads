import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

type FocusDirection = 'first' | 'last' | 'next' | 'previous';

function moveFocus(
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>,
  direction: FocusDirection
): void {
  const enabledItems = itemRefs.current.filter(
    (item): item is HTMLButtonElement => Boolean(item && !item.disabled)
  );
  if (enabledItems.length === 0) {
    return;
  }

  const focusAt = (index: number) => {
    enabledItems[index]?.focus();
  };

  if (direction === 'first') {
    focusAt(0);
    return;
  }

  if (direction === 'last') {
    focusAt(enabledItems.length - 1);
    return;
  }

  const activeElement = document.activeElement;
  const activeIndex =
    activeElement instanceof HTMLButtonElement
      ? enabledItems.indexOf(activeElement)
      : -1;

  if (activeIndex === -1) {
    focusAt(0);
    return;
  }

  const nextIndex =
    direction === 'next'
      ? (activeIndex + 1) % enabledItems.length
      : (activeIndex - 1 + enabledItems.length) % enabledItems.length;

  focusAt(nextIndex);
}

export function handleClassicContextMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>
): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(itemRefs, 'next');
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(itemRefs, 'previous');
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    moveFocus(itemRefs, 'first');
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    moveFocus(itemRefs, 'last');
  }
}
