// What the user does to scroll for themselves; any of them ends the pin.
const USER_SCROLL_EVENTS = [
  "keydown",
  "pointerdown",
  "touchstart",
  "wheel",
] as const;

/**
 * Scroll the scroller so the element matching `selector` sits at its top, and
 * keep it there while what renders above it settles, such as rows loading or
 * the routed tier's type ramp, until the user scrolls for themselves. Only the
 * scroller moves: scrolling into view would also move any clipped ancestor,
 * such as a desktop holding a partly off-screen window. Returns the release.
 */
export function pinSectionToTop(
  scroller: HTMLElement,
  selector: string,
): () => void {
  const align = () => {
    const target = scroller.querySelector(selector);
    if (target === null) return;
    scroller.scrollTop +=
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };
  align();
  // The scroller's own box stays put as its content grows, so watch what it
  // holds.
  const observer = new ResizeObserver(align);
  for (const child of scroller.children) observer.observe(child);
  const release = () => {
    observer.disconnect();
    for (const type of USER_SCROLL_EVENTS) {
      scroller.removeEventListener(type, release);
    }
  };
  for (const type of USER_SCROLL_EVENTS) {
    scroller.addEventListener(type, release, { passive: true });
  }
  return release;
}
