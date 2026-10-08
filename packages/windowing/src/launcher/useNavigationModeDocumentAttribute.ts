import { useEffect } from "react";
import type { NavigationMode } from "./navigationMode";

/**
 * Mirrors the active navigation mode onto `<html data-navigation-mode>` while
 * the caller is mounted, so CSS can size interactive controls for touch
 * whenever the routed (phone / tablet / iPad) shell is active. Stamping the
 * document root lets portaled menus and modals inherit the rules too.
 *
 * The attribute — not a `@media (pointer: coarse)` query — is the touch hook
 * because an iPad with a mouse or trackpad renders the routed layout yet reports
 * `pointer: fine`; a coarse-pointer query would leave every control at its dense
 * desktop size on that device.
 *
 * The package's own stylesheets key their touch sizes off
 * `:root[data-navigation-mode="routed"]`, and so can a host's.
 */
export function useNavigationModeDocumentAttribute(mode: NavigationMode): void {
  useEffect(() => {
    document.documentElement.setAttribute("data-navigation-mode", mode);
    return () => {
      document.documentElement.removeAttribute("data-navigation-mode");
    };
  }, [mode]);
}
