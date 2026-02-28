import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

type FocusDirection = 'first' | 'last' | 'next' | 'previous';
const KEY_TO_DIRECTION_MAP: Record<string, FocusDirection> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last'
};

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
  const direction = KEY_TO_DIRECTION_MAP[event.key];
  if (direction) {
    event.preventDefault();
    moveFocus(itemRefs, direction);
  }
}
