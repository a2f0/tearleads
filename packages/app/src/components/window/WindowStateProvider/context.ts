import {
  createRequiredContext,
  type RequiredContext,
} from "../../../utils/createRequiredContext";
import type { WindowStateActions, WindowStateData } from "./types";

// Keep state and actions in separate contexts so consumers that only need
// stable actions like create/restore do not re-render on every window-state
// change.
export const windowStateContext: RequiredContext<WindowStateData> =
  createRequiredContext("useWindowStateData requires WindowStateProvider");

export const windowActionsContext: RequiredContext<WindowStateActions> =
  createRequiredContext("useWindowActions requires WindowStateProvider");
