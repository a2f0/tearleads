import { useSuppressWindowToolbar } from "@tearleads/windowing";
import { useId } from "react";
import { networkModeOptions } from "../../components/shared/networkModeOptions";
import { useNetworkState } from "../../providers/api/useNetworkState";

export function NetworkSettings() {
  useSuppressWindowToolbar(true);
  const name = useId();
  const { mode, setNetworkMode } = useNetworkState();

  return (
    <fieldset className="app-settings-network">
      <legend>Network control</legend>
      {networkModeOptions.map((option) => (
        <label key={option.mode}>
          <input
            checked={option.mode === mode}
            name={name}
            onChange={() => setNetworkMode(option.mode)}
            type="radio"
            value={option.mode}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
