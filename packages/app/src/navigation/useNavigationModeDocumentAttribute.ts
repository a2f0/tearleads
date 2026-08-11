import { useDocumentRootAttribute } from "../utils/useDocumentRootAttribute";
import type { AppNavigationMode } from "./AppNavigationMode";

/**
 * Mirrors the active navigation mode onto `<html data-navigation-mode>` so CSS
 * can size interactive controls for touch whenever the routed (mobile / tablet
 * / iPad) shell is active.
 *
 * The attribute — not a `@media (pointer: coarse)` query — is the touch hook
 * because an iPad with a mouse or trackpad renders the routed layout yet reports
 * `pointer: fine`; a coarse-pointer query would leave every control at its dense
 * desktop size on that device.
 *
 * See `:root[data-navigation-mode="routed"]` rules in @tearleads/ui's
 * styles.css and across the mini-app component stylesheets.
 */
export function useNavigationModeDocumentAttribute(
  mode: AppNavigationMode,
): void {
  useDocumentRootAttribute("data-navigation-mode", mode);
}
