import { useEffect } from "react";

/**
 * Mirrors `value` onto `<html>` as the `name` attribute while the caller is
 * mounted, removing it on unmount. Stamping the document root (rather than a
 * subtree) lets portaled menus and modals inherit whatever CSS keys off the
 * attribute; a document without the attribute falls back to the stylesheet's
 * base `:root` rules.
 */
export function useDocumentRootAttribute(name: string, value: string): void {
  useEffect(() => {
    document.documentElement.setAttribute(name, value);
    return () => {
      document.documentElement.removeAttribute(name);
    };
  }, [name, value]);
}
