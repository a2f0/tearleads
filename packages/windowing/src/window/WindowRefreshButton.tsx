import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import type { WindowMenuItem } from "./WindowMenuBar";

/** The registered refresh action shared by floating and routed toolbars. */
export function WindowRefreshButton({
  className,
  item,
}: {
  className: string;
  item: WindowMenuItem;
}) {
  return (
    <button
      aria-label={item.label}
      className={className}
      disabled={item.disabled}
      title={item.label}
      type="button"
      onClick={item.onClick}
    >
      <ArrowsClockwiseIcon aria-hidden size={18} />
    </button>
  );
}
