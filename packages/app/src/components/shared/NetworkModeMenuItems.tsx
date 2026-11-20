import { MenuItem } from "@tearleads/windowing";
import { useNetworkState } from "../../providers/api/useNetworkState";
import { networkModeOptions } from "./networkModeOptions";

export function NetworkModeMenuItems({ onClose }: { onClose: () => void }) {
  const { mode, setNetworkMode } = useNetworkState();

  return networkModeOptions
    .filter((option) => option.mode !== mode)
    .map((option) => (
      <MenuItem
        key={option.mode}
        label={option.label}
        onClick={() => {
          setNetworkMode(option.mode);
          onClose();
        }}
      />
    ));
}
