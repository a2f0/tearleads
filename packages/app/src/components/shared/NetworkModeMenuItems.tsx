import { useNetworkState } from "../../providers/api/useNetworkState";
import { MenuItem } from "./MenuItem";

export function NetworkModeMenuItems({
  onClose,
  showManualModeControls = true,
}: {
  onClose: () => void;
  showManualModeControls?: boolean | undefined;
}) {
  const { mode, setNetworkMode } = useNetworkState();

  return (
    <>
      {showManualModeControls && mode !== "online" && (
        <MenuItem
          label="Force Online"
          onClick={() => {
            setNetworkMode("online");
            onClose();
          }}
        />
      )}
      {showManualModeControls && mode !== "offline" && (
        <MenuItem
          label="Force Offline"
          onClick={() => {
            setNetworkMode("offline");
            onClose();
          }}
        />
      )}
      {mode !== "automatic" && (
        <MenuItem
          label="Use Automatic Network"
          onClick={() => {
            setNetworkMode("automatic");
            onClose();
          }}
        />
      )}
    </>
  );
}
