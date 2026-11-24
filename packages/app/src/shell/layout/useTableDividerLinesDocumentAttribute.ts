import { useEffect } from "react";

/**
 * Stamps `<html data-table-divider-lines="hidden">` while the "Hide table
 * divider lines" feature flag is on, so the shared list styles
 * (MiniAppRowDividers.css) can drop the line between one row and the next in
 * every table and divided list at once, without each list reading the flag.
 */
export function useTableDividerLinesDocumentAttribute(hidden: boolean): void {
  useEffect(() => {
    if (!hidden) {
      return;
    }
    const root = document.documentElement;
    root.setAttribute("data-table-divider-lines", "hidden");
    return () => {
      root.removeAttribute("data-table-divider-lines");
    };
  }, [hidden]);
}
