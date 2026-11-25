import { useCallback, useRef } from "react";

function externalLinkTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (!(event.target instanceof Element)) return null;
  const link = event.target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  return link.protocol === "http:" || link.protocol === "https:"
    ? link.href
    : null;
}

/**
 * Opens a web link inside the returned element's document in a new browser
 * context instead of navigating the app away from what the person is in the
 * middle of. Other links, such as `mailto:`, keep their default.
 */
export function useExternalDocumentLinks<ElementType extends HTMLElement>(): (
  element: ElementType | null,
) => void {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((element: ElementType | null) => {
    detach.current?.();
    detach.current = null;
    if (!element) return;
    const open = (event: MouseEvent) => {
      const href = externalLinkTarget(event);
      if (!href) return;
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    };
    element.addEventListener("click", open);
    detach.current = () => element.removeEventListener("click", open);
  }, []);
}
