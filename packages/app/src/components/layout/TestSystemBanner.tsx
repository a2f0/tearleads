import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import "./TestSystemBanner.css";

export const TEST_SYSTEM_WARNING = "Test system. You will lose data.";

/**
 * Standing deployment notice docked directly above the taskbar. Both shells
 * mount it — the windowed pane footer and the routed bottom bar — so every
 * variant (the regular app and the demo alike) carries the same warning.
 *
 * Static chrome rather than a dismissable alert: it states a condition of the
 * deployment that holds for the whole session, so it is not announced and
 * cannot be closed. The routed shell hides it with the taskbar while the
 * software keyboard is up.
 */
export function TestSystemBanner({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="test-system-banner" hidden={hidden}>
      <WarningIcon
        aria-hidden="true"
        className="test-system-banner-icon"
        weight="fill"
      />
      <span>{TEST_SYSTEM_WARNING}</span>
    </div>
  );
}
