import { useNetworkState } from "../../providers/api/useNetworkState";
import { MenuItem } from "./MenuItem";

export function NetworkModeMenuItems({ onClose }: { onClose: () => void }) {
  const { mode, setNetworkMode } = useNetworkState();

  return (
    <>
      {mode !== "online" && (
        <MenuItem
          label="Force Online"
          onClick={() => {
            setNetworkMode("online");
            onClose();
          }}
        />
      )}
      {mode !== "offline" && (
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
