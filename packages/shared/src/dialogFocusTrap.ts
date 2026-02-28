export interface KeyboardEventLike {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

export interface ElementRefLike<T extends HTMLElement = HTMLElement> {
  current: T | null;
}

interface HandleDialogTabTrapArgs {
  event: KeyboardEventLike;
  containerRef: ElementRefLike;
  focusableSelector: string;
}

export function handleDialogTabTrap({
  event,
  containerRef,
  focusableSelector
}: HandleDialogTabTrapArgs): void {
  if (event.key !== 'Tab') {
    return;
  }

  const focusableElements =
    containerRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
  if (!focusableElements || focusableElements.length === 0) {
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  if (!firstElement || !lastElement) {
    return;
  }

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}
