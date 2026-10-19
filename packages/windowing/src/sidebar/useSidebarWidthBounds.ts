import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export const MIN_SIDEBAR_WIDTH = 80;
export const UNMEASURED_MAX_SIDEBAR_WIDTH = 400;

function parentContainer(sidebar: HTMLElement) {
  return sidebar.parentElement;
}

export function useSidebarWidthBounds(
  sidebarRef: RefObject<HTMLDivElement | null>,
  getResizeContainer = parentContainer,
) {
  const [maxWidth, setMaxWidth] = useState(UNMEASURED_MAX_SIDEBAR_WIDTH);
  const maxWidthRef = useRef(maxWidth);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    const container = sidebar && getResizeContainer(sidebar);
    if (!container) return;

    function measure() {
      const availableWidth = container?.getBoundingClientRect().width ?? 0;
      // Hidden layouts have no useful bounds until they become visible again.
      if (availableWidth <= 0) return;
      const nextMax = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.floor(availableWidth * 0.9),
      );
      maxWidthRef.current = nextMax;
      setMaxWidth(nextMax);
    }

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [getResizeContainer, sidebarRef]);

  return { maxWidth, maxWidthRef };
}
