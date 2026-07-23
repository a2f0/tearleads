import type { ReactNode } from "react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../src/components/window/WindowMenuContext";

/**
 * Stands in for the pane header's toolbar so a test can assert what a component
 * registers there.
 *
 * Labels are prefixed with "Toolbar " so a toolbar action never collides with a
 * same-named body or menu control in queries — the point of most of these tests
 * is that a control moved from the body to the toolbar, which a colliding query
 * could not tell apart.
 */
function WindowToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={`Toolbar ${action.label}`}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

/** The probe plus the provider the registration hooks need. */
export function WithWindowToolbar({ children }: { children: ReactNode }) {
  return (
    <WindowMenuProvider>
      <WindowToolbarProbe />
      {children}
    </WindowMenuProvider>
  );
}
