import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import type { LauncherPlacement } from "./LauncherPlacement";

export function RoutedPanePlacementButton({
  launcherPlacement,
  onToggle,
}: {
  launcherPlacement: LauncherPlacement;
  onToggle: () => void;
}) {
  const label =
    launcherPlacement === "side"
      ? "Move launcher to bottom"
      : "Move launcher to side";

  return (
    <button
      aria-label={label}
      className="routed-pane-iconbutton routed-pane-placement-button"
      title={label}
      type="button"
      onClick={onToggle}
    >
      {launcherPlacement === "side" ? (
        <ArrowDownIcon aria-hidden size={18} />
      ) : (
        <ArrowLeftIcon aria-hidden size={18} />
      )}
    </button>
  );
}
