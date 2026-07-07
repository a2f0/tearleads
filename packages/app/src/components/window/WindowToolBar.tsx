import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
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
 * registers its actions once and they appear wherever it is hosted. The row
 * renders nothing when neither a back action nor any toolbar action is
 * registered, so windows without toolbar actions keep a flush menu bar/body.
 */
export function WindowToolBar() {
  const backAction = useWindowBackActionValue();
  const actions = useWindowTitleBarActions();

  if (!backAction && actions.length === 0) {
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
