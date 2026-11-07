import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import "./WindowRefreshButton.css";
import type { WindowRefreshMenuItem } from "./windowMenuRegistrations";

/**
 * The registered refresh action shared by floating and routed toolbars. While
 * the refresh runs, a turning ring replaces the icon so a long refresh reads
 * as work in progress rather than as a disabled button.
 */
export function WindowRefreshButton({
  className,
  item,
}: {
  className: string;
  item: WindowRefreshMenuItem;
}) {
  return (
    <button
      aria-busy={item.refreshing}
      aria-label={item.label}
      className={className}
      disabled={item.disabled}
      title={item.label}
      type="button"
      onClick={item.onClick}
    >
      {item.refreshing ? (
        <RefreshSpinner />
      ) : (
        <ArrowsClockwiseIcon aria-hidden size={18} />
      )}
    </button>
  );
}

// An open ring on the icon set's 256-unit grid and 16-unit stroke, so each
// toolbar's icon sizing applies to it exactly as to the icon it replaces.
function RefreshSpinner() {
  return (
    <svg
      aria-hidden
      className="window-refresh-spinner"
      height={18}
      viewBox="0 0 256 256"
      width={18}
    >
      <circle
        cx={128}
        cy={128}
        fill="none"
        pathLength={4}
        r={96}
        stroke="currentColor"
        strokeDasharray="3 1"
        strokeLinecap="round"
        strokeWidth={16}
      />
    </svg>
  );
}
