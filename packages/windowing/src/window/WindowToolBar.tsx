import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { useState } from "react";
import "./WindowToolBar.css";
import { WindowTitleBarActionButtons } from "./WindowChromeActions";
import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
  useWindowToolbarReservationReleased,
  useWindowToolbarReserved,
} from "./WindowMenuContext";

/**
 * The window's toolbar row, sitting below the File/View menu bar and above the
 * body. It renders the same actions the routed app bar shows — the registered
 * {@link useWindowBackAction} on the left and {@link useWindowTitleBarAction}
 * icon buttons on the right — so a mini-app hosted in a window gets the same
 * toolbar chrome it gets in the routed shell.
 *
 * The left slot resolves exactly as `RoutedPaneAppBar` does: a registered back
 * action wins, and otherwise the button steps back through the host's own
 * history. `showHistoryBack` turns that fallback on for a window hosting a
 * routed mini-app, whose history is the window's Back stack (windows are not
 * backed by browser history); the fallback is omitted when that stack is empty.
 * Unlike the routed shell's paired Back/Forward controls, the window has no
 * adjacent history control whose stable placement would justify a disabled
 * Back button.
 *
 * Both surfaces read one shared registry (WindowMenuContext), so a mini-app
 * registers its actions once and they appear wherever it is hosted.
 *
 * A window whose app never registers toolbar chrome keeps a flush menu bar/body
 * (the row renders nothing). But once an app HAS shown chrome, the row stays
 * mounted and reserves its {@link WindowToolBar.css} min-height even when the
 * action set momentarily clears — on an action-less sub-route or a loading tick
 * where the app's `show` conditions are briefly false. Unmounting the row in
 * those windows would drop a full bar-height out of the flex column and shift
 * the body up, then back down when the actions re-register (visible flicker).
 *
 * An app that wants the row on every route — a blank bar where a route carries
 * no actions, rather than one that only appears after some route first shows
 * chrome — reserves it via {@link useWindowToolbarReservation} (the reserved row
 * still mounts a commit late, once that hook's effect registers, as all window
 * chrome does).
 */
export function WindowToolBar({
  canGoBack = false,
  onGoBack,
  showHistoryBack = false,
}: {
  canGoBack?: boolean;
  onGoBack?: (() => void) | undefined;
  showHistoryBack?: boolean;
} = {}) {
  const backAction = useWindowBackActionValue();
  const actions = useWindowTitleBarActions();
  const reserved = useWindowToolbarReserved();
  const reservationReleased = useWindowToolbarReservationReleased();
  const showBack = backAction !== null || (showHistoryBack && canGoBack);
  const hasChrome =
    backAction !== null || showHistoryBack || actions.length > 0;
  // Latch: this window's app has shown toolbar chrome at least once, so keep the
  // row reserved from here on rather than collapsing it on a transient empty.
  // Seed from the mount-time value so a window that already has chrome does not
  // latch during render at all; the render-phase set below catches chrome that
  // first appears after mount, without an effect's extra committed render pass.
  const [hasShownChrome, setHasShownChrome] = useState(hasChrome);
  let latchedChrome = hasShownChrome;
  if (hasChrome && !latchedChrome) {
    setHasShownChrome(true);
    latchedChrome = true;
  } else if (!hasChrome && reservationReleased && latchedChrome) {
    setHasShownChrome(false);
    latchedChrome = false;
  }

  if (!hasChrome && !latchedChrome && !reserved) {
    return null;
  }

  const backLabel = backAction?.label ?? "Back";

  return (
    <div aria-label="Toolbar" className="window-toolbar" role="toolbar">
      <div className="window-toolbar-primary">
        {showBack && (
          <button
            aria-label={backLabel}
            className="window-toolbar-button"
            disabled={backAction?.disabled ?? false}
            title={backLabel}
            type="button"
            onClick={backAction?.onClick ?? onGoBack}
          >
            <CaretLeftIcon aria-hidden size={18} />
            <span className="window-toolbar-back-label">{backLabel}</span>
          </button>
        )}
      </div>
      <div className="window-toolbar-spacer" />
      {actions.length > 0 && (
        <div className="window-toolbar-actions">
          <WindowTitleBarActionButtons
            actions={actions}
            className="window-toolbar-button"
          />
        </div>
      )}
    </div>
  );
}
