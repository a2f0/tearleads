import type { RefObject } from 'react';

interface HandleDialogTabTrapArgs {
  event: React.KeyboardEvent;
  containerRef: RefObject<HTMLElement | null>;
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
