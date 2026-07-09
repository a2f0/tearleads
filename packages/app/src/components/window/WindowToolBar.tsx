import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { useEffect, useState } from "react";
import "./WindowToolBar.css";
import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
} from "./WindowMenuContext";

/**
 * The window's toolbar row, sitting below the File/View menu bar and above the
 * body. It renders the same actions the routed app bar shows — the registered
 * {@link useWindowBackAction} on the left and {@link useWindowTitleBarAction}
 * icon buttons on the right — so a mini-app hosted in a window gets the same
 * toolbar chrome it gets in the routed shell.
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
 */
export function WindowToolBar() {
  const backAction = useWindowBackActionValue();
  const actions = useWindowTitleBarActions();
  const hasChrome = backAction !== null || actions.length > 0;
  // Latch: this window's app has shown toolbar chrome at least once, so keep the
  // row reserved from here on rather than collapsing it on a transient empty.
  const [hasShownChrome, setHasShownChrome] = useState(false);
  useEffect(() => {
    if (hasChrome) {
      setHasShownChrome(true);
    }
  }, [hasChrome]);

  if (!hasChrome && !hasShownChrome) {
    return null;
  }

  const backLabel = backAction?.label ?? "Back";

  return (
    <div aria-label="Toolbar" className="window-toolbar" role="toolbar">
      <div className="window-toolbar-primary">
        {backAction && (
          <button
            className="window-toolbar-button"
            disabled={backAction.disabled}
            title={backLabel}
            type="button"
            onClick={backAction.onClick}
          >
            <CaretLeftIcon aria-hidden size={18} />
            <span className="window-toolbar-back-label">{backLabel}</span>
          </button>
        )}
      </div>
      <div className="window-toolbar-spacer" />
      {actions.length > 0 && (
        <div className="window-toolbar-actions">
          {actions.map((action) => (
            <button
              aria-label={action.label}
              className="window-toolbar-button"
              disabled={action.disabled}
              key={action.id}
              title={action.label}
              type="button"
              onClick={action.onClick}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
